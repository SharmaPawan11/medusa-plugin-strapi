import { BaseService } from "medusa-interfaces"
import axios from "axios"
import {response} from "express";

const IGNORE_THRESHOLD = 2 // seconds

class StrapiService extends BaseService {
  constructor(
    {
      regionService,
      productService,
      redisClient,
      productVariantService,
      eventBusService,
    },
    options
  ) {
    super()


    this.productService_ = productService

    this.productVariantService_ = productVariantService

    this.regionService_ = regionService

    this.eventBus_ = eventBusService

    this.options_ = options

    this.strapiAuthToken = '';

    this.retryCount = 0;

    this.checkStrapiHealth().then((res) => {
      if (res) {
        this.loginToStrapi();
      }
    });


    // console.log(this.options_);

    // init Strapi client
    this.strapi_ = this.createClient()

    this.redis_ = redisClient
  }

  createClient() {
    const client = axios.create({
      baseURL: process.env.STRAPI_URL || "http://localhost:1337",
    })

    return client
  }

  async addIgnore_(id, side) {
    const key = `${id}_ignore_${side}`
    return await this.redis_.set(
      key,
      1,
      "EX",
      this.options_.ignore_threshold || IGNORE_THRESHOLD
    )
  }

  async shouldIgnore_(id, side) {
    const key = `${id}_ignore_${side}`
    return await this.redis_.get(key)
  }

  async getVariantEntries_(variants) {
    try {
      const allVariants = variants.map(async (variant) => {
        // update product variant in strapi
        const result = await this.updateProductVariantInStrapi(variant);
        return result.productVariant;
      })
      return Promise.all(allVariants);
    } catch (error) {
      throw error
    }
  }

  async createImageAssets(product) {
    let assets;
    assets = await Promise.all(
      product.images
        .filter((image) => image.url !== product.thumbnail)
        .map(async (image, i) => {
          const result = await this.createEntryInStrapi('images', {
          image_id: image.id,
          url: image.url,
          metadata: image.metadata || {}
           });
          return result.image;
        })
    )
    return assets || [];
  }

  getCustomField(field, type) {
    const customOptions = this.options_[`custom_${type}_fields`]

    if (customOptions) {
      return customOptions[field] || field
    } else {
      return field
    }
  }

  async createProductInStrapi(productId) {
    const hasType = await this.getType("products")
      .then(() => true)
      .catch((err) => {
        // console.log(err);
        return false;
      })
    if (!hasType) {
      return Promise.resolve()
    }

    try {
      const product = await this.productService_.retrieve(productId, {
        relations: [
          "variants",
          "options",
          "tags",
          "type",
          "collection",
          "images",
        ],
      })

      // update or create all variants for the product
      const variantEntries = await this.getVariantEntries_(product.variants);
      const strapiProductVariants = [];
      variantEntries.forEach((entry) => {
        strapiProductVariants.push({ id: entry.id });
      });

      delete product.variants;
      product.product_variants = strapiProductVariants;

      const fields = await this.generateStrapiProductPayload(product);

      // create product in Strapi with product id and fields object
      return await this.createEntryInStrapi("products", fields);

    } catch (error) {
      throw error
    }
  }

  async createProductVariantInStrapi(variantId) {
    console.log(variantId);
    const hasType = await this.getType("product-variants")
      .then(() => true)
      .catch(() => false)

    if (!hasType) {
      return Promise.resolve()
    }

    try {
      const variant = await this.productVariantService_.retrieve(variantId, {
        relations: [
          "prices",
          "options",
          "product"
        ],
      })

      // console.log(variant);

      // create variant in Strapi with variant id and variant properties
      const fields = this.generateStrapiProductVariantPayload(variant);
      return await this.createEntryInStrapi('product-variants', fields);
    } catch (error) {
      throw error
    }
  }

  async createRegionInStrapi(regionId) {
    // console.log(regionId);
    const hasType = await this.getType("regions")
      .then(() => true)
      .catch(() => false)
    if (!hasType) {
      console.log('Type "Regions" doesnt exist in Strapi');
      return Promise.resolve()
    }

    try {
      const region = await this.regionService_.retrieve(regionId, {
        relations: ["countries", "payment_providers", "fulfillment_providers"],
      })

      // console.log(region)

      // initiate the fields for the region in Strapi
      const fields = this.generateStrapiRegionPayload(region);

      // create the region in Strapi with region id and fields object
      return await this.createEntryInStrapi('regions', fields)
    } catch (error) {
      throw error
    }
  }

  async updateRegionInStrapi(data) {
    const hasType = await this.getType("regions")
      .then((res) => {
        // console.log(res.data);
        return true;
      })
      .catch((error) => {
        // console.log(error.response.status);
        return false;
      })
    if (!hasType) {
      return Promise.resolve()
    }

    const updateFields = [
      "name",
      "currency_code",
      "countries",
      "payment_providers",
      "fulfillment_providers",
    ]

    // check if update contains any fields in Strapi to minimize runs
    const found = data.fields.find((f) => updateFields.includes(f))
    if (!found) {
      return
    }

    try {
      const ignore = await this.shouldIgnore_(data.id, "strapi")
      if (ignore) {
        return
      }

      const region = await this.regionService_.retrieve(data.id, {
        relations: ["countries", "payment_providers", "fulfillment_providers"],
      })

      let hasRegionEntry = false;
      try {
        // fetch from Strapi
        hasRegionEntry = await this.doesEntryExistInStrapi('regions', region.id);
      } catch (error) {
        return this.createRegionInStrapi(region.id);
      }

      if (hasRegionEntry) {
        const fields = this.generateStrapiRegionPayload(region);
        // update entry in Strapi
        const response = await this.updateEntryInStrapi('regions', fields.region_id, fields);
        // console.log('Final Response after update', response);
      }

      await this.addIgnore_(data.id, "medusa-strapi")
      return region;
    } catch (error) {
      throw error
    }
  }

  async updateProductInStrapi(data) {
    // console.log(data);
    const updateFields = [
      "variants",
      "options",
      "tags",
      "title",
      "subtitle",
      "tags",
      "type",
      "type_id",
      "collection",
      "collection_id",
      "thumbnail",
    ]

    // check if update contains any fields in Strapi to minimize runs
    const found = data.fields.find((f) => updateFields.includes(f))
    if (!found) {
      return Promise.resolve()
    }

    try {
      const ignore = await this.shouldIgnore_(data.id, "strapi")
      if (ignore) {
        return Promise.resolve()
      }

      const product = await this.productService_.retrieve(data.id, {
        relations: [
          "options",
          "variants",
          "type",
          "collection",
          "tags",
          "images",
        ],
      })

      // console.log(product);

      // check if product exists
      let hasProductEntry = false;
      try {
        // fetch entry in Strapi
        hasProductEntry = await this.doesEntryExistInStrapi('products', product.id);
      } catch (error) {
        return this.createProductInStrapi(product)
      }

      if (hasProductEntry) {
        const variantEntries = await this.getVariantEntries_(product.variants);
        const strapiProductVariants = [];
        variantEntries.forEach((entry) => {
          strapiProductVariants.push({ id: entry.id });
        });

        delete product.variants;
        product.product_variants = strapiProductVariants;

        const fields = await this.generateStrapiProductPayload(product);
        const response = await this.updateEntryInStrapi('products', fields.product_id, fields);
        console.log(response);
      }
      await this.addIgnore_(data.id, "medusa-strapi")

      return product;
    } catch (error) {
      throw error
    }
  }

  async updateProductVariantInStrapi(data) {

    const updateFields = [
      "title",
      "prices",
      "sku",
      "material",
      "weight",
      "length",
      "height",
      "origin_country",
      "options",
    ]

    // Update came directly from product variant service so only act on a couple
    // of fields. When the update comes from the product we want to ensure
    // references are set up correctly so we run through everything.
    if (data.fields) {
      const found = data.fields.find((f) => updateFields.includes(f))
      if (!found) {
        return Promise.resolve()
      }
    }

    try {
      const ignore = await this.shouldIgnore_(data.id, "strapi")
      if (ignore) {
        return Promise.resolve()
      }

      const variant = await this.productVariantService_.retrieve(data.id, {
        relations: ["prices", "options"],
      });

      // check if variant exists
      let hasVariantEntry = false;
      // if not, we create a new one
      try {
        // fetch variant in Strapi
        hasVariantEntry = await this.doesEntryExistInStrapi('product-variants', data.id);
      } catch (error) {
        // if we fail to find the variant, we create it
        return this.createProductVariantInStrapi(data.id);
      }

      if (hasVariantEntry) {
        // previous fields and new fields
        const fields = this.generateStrapiProductVariantPayload(variant);
        // update entry in Strapi
        const response = await this.updateEntryInStrapi('product-variants', fields.product_variant_id, fields);
        await this.addIgnore_(variant.id, "medusa-strapi")
        // console.log('Successfully Updated Product Variant', response);
        return response;

      }

    } catch (error) {
      console.log('Failed to update product variant', data.id);
      throw error
    }
  }

  async deleteProductInStrapi(data) {
    const hasType = await this.getType("products")
        .then(() => true)
        .catch((err) => {
          // console.log(err);
          return false;
        })
    if (!hasType) {
      return Promise.resolve()
    }

    return await this.deleteEntryInStrapi("products", data.id);
  }

  async deleteProductVariantInStrapi(data) {
    const hasType = await this.getType("product-variants")
        .then(() => true)
        .catch((err) => {
          // console.log(err);
          return false;
        })
    if (!hasType) {
      return Promise.resolve()
    }

    return await this.deleteEntryInStrapi("product-variants", data.id);
  }

  // Blocker - Delete Region API
  async deleteRegionInStrapi(data) {

  }

  // Buggy - Don't uncomment lifecycle hooks in product in strapi else infinite requests.
  async sendStrapiProductToAdmin(productEntry, productId) {
    const ignore = await this.shouldIgnore_(productId, "medusa-strapi")
    if (ignore) {
      return
    }

    try {
      // get entry from Strapi
      // const productEntry = null

      const product = await this.productService_.retrieve(productId);
      console.log(product);

      let update = {}

      // update Medusa product with Strapi product fields
      const title = ""
      const subtitle = ""
      const description = ""

      if (product.title !== title) {
        update.title = title
      }

      if (product.subtitle !== subtitle) {
        update.subtitle = subtitle
      }

      if (product.description !== description) {
        update.description = description
      }

      // Get the thumbnail, if present
      if (productEntry.thumbnail) {
        const thumb = null
        update.thumbnail = thumb;
      }

      await this.productService_.update(productId, update).then(async () => {
        return await this.addIgnore_(productId, "strapi")
      })
      // if (!_.isEmpty(update)) {
      //
      // }
    } catch (error) {
      throw error
    }
  }

  // Yet to be implemented
  async sendStrapiProductVariantToAdmin(variantId) {
    const ignore = this.shouldIgnore_(variantId, "medusa-strapi")
    if (ignore) {
      return
    }

    try {
      // get entry from Strapi
      const variantEntry = null

      const updatedVariant = await this.productVariantService_
        .update(variantId, {
          title: "", // update variant title in Medusa
        })
        .then(async () => {
          return await this.addIgnore_(variantId, "strapi")
        })

      return updatedVariant
    } catch (error) {
      throw error
    }
  }

  async getType(type) {
    const config = {
      method: 'get',
      url: `http://localhost:1337/${type}`,
      headers: {
        'Authorization': `Bearer ${this.strapiAuthToken}`
      }
    };

    return axios(config);
  }

  async checkStrapiHealth() {
    const config = {
      method: 'head',
      url: `http://localhost:1337/_health`
    };
    return axios(config).then((res) => {
      if (res.status === 204) {
        console.log('\n Strapi Health Check OK \n');
      }
      return true;
    }).catch((error) => {
      if (error.code === 'ECONNREFUSED') {
        console.error('Could not connect to strapi. Please make sure strapi is running.')
      }
      return false;
    })
  }

  async loginToStrapi() {
    const config = {
      method: 'post',
      url: `http://localhost:1337/auth/local`,
      data: {
        identifier: this.options_.strapi_medusa_user,
        password: this.options_.strapi_medusa_password
      },
    };
    return axios(config).then((res) => {
      if (res.data.jwt) {
        this.strapiAuthToken = res.data.jwt;
        console.log('\n Successfully logged in to Strapi \n');
        return true
      }
      return false;
    }).catch((error) => {
      if (error) {
        throw new Error("Error while trying to login to strapi");
      }
    })
  }

  async retryOnceOnTokenExpire(error, type, data) {
    if (error.response.status === 403 || error.response.status === 401) {
      console.log('Authentication error');
      const tokenRefreshed = await this.loginToStrapi();
      if (tokenRefreshed) {
        this.retryCount++;
        return this.createEntryInStrapi(type, data);
      }
    }
  }

  async createEntryInStrapi(type, data) {
    const config = {
      method: 'post',
      url: `http://localhost:1337/${type}`,
      headers: {
        'Authorization': `Bearer ${this.strapiAuthToken}`
      },
      data
    };
    return axios(config).then((res) => {
      if (res.data.result) {
        this.retryCount = 0;
        return res.data.data
      }
      return null;
    }).catch(async (error) => {
      if (error && error.response && error.response.status) {
        if (this.retryCount === 0) {
          return await this.retryOnceOnTokenExpire(error, type, data);
        }
        throw new Error("Error while trying to create entry in strapi - " + type);
      }
    })
  }

  async updateEntryInStrapi(type, id, data) {
    const config = {
      method: 'put',
      url: `http://localhost:1337/${type}/${id}`,
      headers: {
        Authorization: `Bearer ${this.strapiAuthToken}`
      },
      data
    };
    return axios(config).then((res) => {
      if (res.data.result) {
        return res.data.data
      }
      return null;
    }).catch(async (error) => {
      if (error && error.response && error.response.status) {
        if (this.retryCount === 0) {
          return await this.retryOnceOnTokenExpire(error, type, data);
        }
        throw new Error("Error while trying to update entry in strapi ");
      }
    })
  }

  async deleteEntryInStrapi(type, id) {
    const config = {
      method: 'delete',
      url: `http://localhost:1337/${type}/${id}`,
      headers: {
        Authorization: `Bearer ${this.strapiAuthToken}`
      },
    };
    return axios(config).then((res) => {
      if (res.data.result) {
        return res.data.data
      }
      return null;
    }).catch(async (error) => {
      if (error && error.response && error.response.status) {
        if (this.retryCount === 0) {
          return await this.retryOnceOnTokenExpire(error, type, data);
        }
        throw new Error("Error while trying to delete entry in strapi ");
      }
    })
  }

  async doesEntryExistInStrapi(type, id) {
    const config = {
      method: 'get',
      url: `http://localhost:1337/${type}/${id}`,
      headers: {
        Authorization: `Bearer ${this.strapiAuthToken}`
      }
    };

    return axios(config).then((res) => {
      return true;
    }).catch((error) => {
      console.log(error.response.status, id);
      throw new Error("Given entry doesn't exist in Strapi");
    })
  }

  generateStrapiRegionPayload(region) {
    return {
      region_id: region.id,
      name: region.name,
      currency: region.currency_code,
      tax_rate: region.tax_rate,
      tax_code: region.tax_code,
      metadata: region.metadata || {},
      countries: region.countries,
      fulfillment_providers: region.fulfillment_providers.map((provider) => {
        return { fulfillment_provider_id: provider.id, is_installed: provider.is_installed }
      }),
      payment_providers: region.payment_providers.map((provider) => {
        return { payment_provider_id: provider.id, is_installed: provider.is_installed }
      })

    }
  }

  generateStrapiProductVariantPayload(productVariant) {
    return {
      product_variant_id: productVariant.id,
      title: productVariant.title,
      product: productVariant.product_id,
      money_amounts: productVariant.prices.map(({id, ...money_amount}) => {
        return { ...money_amount, money_amount_id: id }
      }),
      product_option_values: productVariant.options.map(({id, ...product_option_value}) => {
        return { ...product_option_value, product_option_value_id: id }
      }),
      sku: productVariant.sku,
      barcode: productVariant.barcode,
      ean: productVariant.ean,
      upc: productVariant.upc,
      variant_rank: productVariant.variant_rank,
      inventory_quantity: productVariant.inventory_quantity,
      allow_backorder: productVariant.allow_backorder,
      manage_inventory: productVariant.manage_inventory,
      hs_code: productVariant.hs_code,
      origin_country: productVariant.origin_country,
      mid_code: productVariant.mid_code,
      material: productVariant.material,
      weight: productVariant.weight,
      product_variant_length: productVariant.length,
      height: productVariant.height,
      width: productVariant.width,
      metadata: productVariant.metadata || {},
    }
  }

  async generateStrapiProductPayload(product) {
    const fields = {
      product_id: product.id,
      title: product.title,
      subtitle: product.subtitle,
      description: product.description,
      handle: product.handle,
      is_giftcard: product.is_giftcard,
      status: product.status,
      thumbnail: product.thumbnail,
      weight: product.weight,
      height: product.height,
      width: product.width,
      product_length: product.length,
      hs_code: product.hs_code,
      origin_country: product.origin_country,
      mid_code: product.mid_code,
      material: product.material,
      discountable: product.discountable,
      metadata: product.metadata || {},
      product_variants: product.product_variants
    };

    // Ignore 'id' field from each "many-to-one" reference (type and collection)
    if (product.type) {
      const { 'id': typeId, ...type } = product.type;
      fields.type = { ...type, product_type_id: typeId }
    }

    if (product.collection) {
      const { 'id': collectionId, ...collection } = product.collection;
      fields.collection = { ...collection, product_collection_id: collectionId }
    }

    // profile comes undefined for some reason.
    fields.shipping_profile_id = product.profile_id;

    if (product.tags) {
      fields.tags = product.tags.map(({id, ...tag}) => {
        return {...tag, product_tag_id: id}
      })
    }

    if (product.options) {
      fields.options = product.options.map(({id, ...option}) => {
        return {...option, product_option_id: id}
      })
    }

    // add images to Strapi product
    if (product.images.length > 0) {
      const images = await this.createImageAssets(product);
      const strapiProductImages = [];
      images.forEach((image) => {
        strapiProductImages.push({ image: image.id });
      });
      fields.images = strapiProductImages;
    }


    return fields;
  }



}

export default StrapiService
