import { BaseService } from "medusa-interfaces"
import axios from "axios"

const IGNORE_THRESHOLD = 3 // seconds

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

  isEmptyObject(obj) {
    for (let i in obj) return false;
    return true;
  }


  createClient() {
    const client = axios.create({
      baseURL: process.env.STRAPI_URL || "http://localhost:1337",
    })

    return client
  }

  async getAllKeys() {
    const keys = await this.redis_.keys('prod');
    keys.forEach((key) => {
      console.log(key);
    });
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
          const result = await this.createEntryInStrapi('images', product.id, {
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
          "options",
          "variants",
          "variants.prices",
          "variants.options",
          "type",
          "collection",
          "tags",
          "images",
        ],
        select: [
          "id",
          "title",
          "subtitle",
          "description",
          "handle",
          "is_giftcard",
          "discountable",
          "thumbnail",
          "weight",
          "length",
          "height",
          "width",
          "hs_code",
          "origin_country",
          "mid_code",
          "material",
          "metadata",
        ]
      })

      if (product) {
        return await this.createEntryInStrapi('products', productId, product);
      }

    } catch (error) {
      throw error
    }
  }

  async createProductVariantInStrapi(variantId) {
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
      if (variant) {
        return await this.createEntryInStrapi('product-variants', variantId, variant);
      }
    } catch (error) {
      throw error
    }
  }

  async createRegionInStrapi(regionId) {
    const hasType = await this.getType("regions")
      .then(() => true)
      .catch(() => false)
    if (!hasType) {
      console.log('Type "Regions" doesnt exist in Strapi');
      return Promise.resolve()
    }

    try {
      const region = await this.regionService_.retrieve(regionId, {
        relations: ["countries", "payment_providers", "fulfillment_providers", "currency"],
        select: ["id", "name", "tax_rate", "tax_code", "metadata"]
      });

      // console.log(region)

      return await this.createEntryInStrapi('regions', regionId, region);
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
        relations: ["countries", "payment_providers", "fulfillment_providers", "currency"],
        select: ["id", "name", "tax_rate", "tax_code", "metadata"]
      });
      // console.log(region);

      if (region) {
        // Update entry in Strapi
        const response = await this.updateEntryInStrapi('regions', region.id, region);
        console.log('Region Strapi Id - ', response);
      }

      return region;
    } catch (error) {
      throw error
    }
  }

  async updateProductInStrapi(data) {
    const hasType = await this.getType("products")
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
      await this.getAllKeys();
      const ignore = await this.shouldIgnore_(data.id, "strapi")
      if (ignore) {
        console.log('Strapi has just updated this product which triggered this function. IGNORING... ')
        return Promise.resolve()
      }

      const product = await this.productService_.retrieve(data.id, {
        relations: [
          "options",
          "variants",
          "variants.prices",
          "variants.options",
          "type",
          "collection",
          "tags",
          "images",
        ],
        select: [
          "id",
          "title",
          "subtitle",
          "description",
          "handle",
          "is_giftcard",
          "discountable",
          "thumbnail",
          "weight",
          "length",
          "height",
          "width",
          "hs_code",
          "origin_country",
          "mid_code",
          "material",
          "metadata",
        ]
      });

      if (product) {
        const response = await this.updateEntryInStrapi('products', product.id, product);
      }

      return product;
    } catch (error) {
      throw error
    }
  }

  async updateProductVariantInStrapi(data) {

    const hasType = await this.getType("product-variants")
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
      console.log(variant);

      if (variant) {
        // Update entry in Strapi
        const response = await this.updateEntryInStrapi('product-variants', variant.id, variant);
        console.log('Variant Strapi Id - ', response);
      }

      return variant;
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

    const ignore = await this.shouldIgnore_(data.id, "strapi")
    if (ignore) {
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

    const ignore = await this.shouldIgnore_(data.id, "strapi")
    if (ignore) {
      return Promise.resolve()
    }

    return await this.deleteEntryInStrapi("product-variants", data.id);
  }

  // Blocker - Delete Region API
  async deleteRegionInStrapi(data) {

  }

  // Buggy - Don't uncomment lifecycle hooks in product in strapi else infinite requests.
  async sendStrapiProductToAdmin(productEntry, productId) {
    await this.getAllKeys();
    const ignore = await this.shouldIgnore_(productId, "medusa")
    if (ignore) {
      console.log('Medusa has just updated this product which triggered this function. IGNORING... ');
      return
    }

    try {
      // get entry from Strapi
      // const productEntry = null

      const product = await this.productService_.retrieve(productId);

      let update = {}

      // update Medusa product with Strapi product fields
      const title = productEntry.title;
      const subtitle = productEntry.subtitle;
      const description = productEntry.description;
      const handle = productEntry.handle;

      if (product.title !== title) {
        update.title = title
      }

      if (product.subtitle !== subtitle) {
        update.subtitle = subtitle
      }

      if (product.description !== description) {
        update.description = description
      }

      if (product.handle !== handle) {
        update.handle = handle
      }

      // Get the thumbnail, if present
      if (productEntry.thumbnail) {
        const thumb = null
        update.thumbnail = thumb;
      }

      if (!this.isEmptyObject(update)) {
        await this.productService_.update(productId, update).then(async () => {
          return await this.addIgnore_(productId, "strapi")
        })
      }
    } catch (error) {
      throw error
    }
  }

  async sendStrapiProductVariantToAdmin(variantEntry, variantId) {
    const ignore = await this.shouldIgnore_(variantId, "medusa");
    if (ignore) {
      return
    }

    try {

      const variant = await this.productVariantService_.retrieve(variantId);
      let update = {}

      if (variant.title !== variantEntry.title) {
        update.title = variantEntry.title
      }

      if (!this.isEmptyObject(update)) {
        const updatedVariant = await this.productVariantService_
            .update(variantId, update)
            .then(async () => {
              return await this.addIgnore_(variantId, "strapi")
            })

        return updatedVariant
      }
    } catch (error) {
      throw error
    }
  }

  async getType(type) {
    if (!this.strapiAuthToken) {
      await this.loginToStrapi();
    }
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
    console.log('Checking strapi Health');
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

  async retryOnceOnTokenExpire(error, type, id, data) {
    if (error.response.status === 403 || error.response.status === 401) {
      console.log('Authentication error');
      const tokenRefreshed = await this.loginToStrapi();
      if (tokenRefreshed) {
        this.retryCount++;
        return this.createEntryInStrapi(type, id, data);
      }
    }
  }

  async createEntryInStrapi(type, id, data) {
    if (!this.strapiAuthToken) {
      await this.loginToStrapi();
    }
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
        this.addIgnore_(id, "medusa");
        this.retryCount = 0;
        return res.data.data
      }
      return null;
    }).catch(async (error) => {
      if (error && error.response && error.response.status) {
        if (this.retryCount === 0) {
          return await this.retryOnceOnTokenExpire(error, type, id, data);
        }
        throw new Error("Error while trying to create entry in strapi - " + type);
      }
    })
  }

  async updateEntryInStrapi(type, id, data) {
    if (!this.strapiAuthToken) {
      await this.loginToStrapi();
    }
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
        this.addIgnore_(id, "medusa");
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
    if (!this.strapiAuthToken) {
      await this.loginToStrapi();
    }
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
    if (!this.strapiAuthToken) {
      await this.loginToStrapi();
    }
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

}

export default StrapiService
