import { BaseService } from "medusa-interfaces"
import axios from "axios"

const IGNORE_THRESHOLD = 3 // seconds

class UpdateStrapiService extends BaseService {
  constructor(
    {
      regionService,
      productService,
      redisClient,
      productVariantService,
      eventBusService,
      productCategoryService,
      productCollectionService,
    },
    options
  ) {
    super()

    this.productService_ = productService

    this.productVariantService_ = productVariantService

    this.regionService_ = regionService

    this.eventBus_ = eventBusService

    this.productCategory_ = productCategoryService

    this.productCollection_ = productCollectionService

    this.options_ = options

    this.protocol = this.options_.strapi_protocol

    this.strapi_URL_STRING=`${this.protocol??"https"}://${this.options_.strapi_url??"localhost"}:${this.options_.strapi_port??1337}`


    this.strapiAuthToken = ""

    this.checkStrapiHealth().then((res) => {
      if (res) {
        this.loginToStrapi()
      }
    })

    this.redis_ = redisClient
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
    // eslint-disable-next-line no-useless-catch
    try {
      const allVariants = variants.map(async (variant) => {
        // update product variant in strapi
        const result = await this.updateProductVariantInStrapi(variant)
        return result.productVariant
      })
      return Promise.all(allVariants)
    } catch (error) {
      throw error
    }
  }

  async createImageAssets(product) {
    const assets = await Promise.all(
      product.images
        .filter((image) => image.url !== product.thumbnail)
        .map(async (image, i) => {
          const result = await this.createEntryInStrapi("images", product.id, {
            image_id: image.id,
            url: image.url,
            metadata: image.metadata || {},
          })
          return result.image
        })
    )
    return assets || []
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
        // console.log(err)
        return false
      })
    if (!hasType) {
      return Promise.resolve()
    }

    // eslint-disable-next-line no-useless-catch
    let relations= [
      "options",
      "variants",
      "variants.prices",
      "variants.options",
      "type",
      "collection",
      "tags",
      "images",
    ]
    if(process.env.MEDUSA_FF_PRODUCT_CATEGORIES === "true"){
      relations.push("categories");
    }
    try {
      const product = await this.productService_.retrieve(productId, {
        relations,
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
        ],
      })

      if (product) {
        const response = await this.createEntryInStrapi("products", productId, product);
        console.log("Product Strapi Id - ", response);
        return response;
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

    // eslint-disable-next-line no-useless-catch
    try {
      const variant = await this.productVariantService_.retrieve(variantId, {
        relations: ["prices", "options", "product"],
      })

      // console.log(variant)
      if (variant) {
        const response = await this.createEntryInStrapi(
          "product-variants",
          variantId,
          variant
        );
        console.log("Product Variant Strapi Id - ", response);
        return response;
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
      console.log('Type "Regions" doesnt exist in Strapi')
      return Promise.resolve()
    }

    // eslint-disable-next-line no-useless-catch
    try {
      const region = await this.regionService_.retrieve(regionId, {
        relations: [
          "countries",
          "payment_providers",
          "fulfillment_providers",
          "currency",
        ],
        select: ["id", "name", "tax_rate", "tax_code", "metadata"],
      })

      // console.log(region)
      const response = await this.createEntryInStrapi("regions", regionId, region);
      console.log("Region Strapi Id - ", response);
      return response;
    } catch (error) {
      throw error
    }
  }

  async updateRegionInStrapi(data) {
    const hasType = await this.getType("regions")
      .then((res) => {
        // console.log(res.data)
        return true
      })
      .catch((error) => {
        // console.log(error.response.status)
        return false
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

    // eslint-disable-next-line no-useless-catch
    try {
      const ignore = await this.shouldIgnore_(data.id, "strapi")
      if (ignore) {
        return
      }

      const region = await this.regionService_.retrieve(data.id, {
        relations: [
          "countries",
          "payment_providers",
          "fulfillment_providers",
          "currency",
        ],
        select: ["id", "name", "tax_rate", "tax_code", "metadata"],
      })
      // console.log(region)

      if (region) {
        // Update entry in Strapi
        const response = await this.updateEntryInStrapi(
          "regions",
          region.id,
          region
        )
        console.log("Region Strapi Id - ", response)
      }

      return region
    } catch (error) {
      throw error
    }
  }

  async updateProductInStrapi(data) {
    const hasType = await this.getType("products")
      .then((res) => {
        // console.log(res.data)
        return true
      })
      .catch((error) => {
        // console.log(error.response.status)
        return false
      })
    if (!hasType) {
      return Promise.resolve()
    }

    // console.log(data)
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
      "categories"
    ]

    // check if update contains any fields in Strapi to minimize runs
    const found = data.fields.find((f) => updateFields.includes(f))
    if (!found) {
      return Promise.resolve()
    }

    // eslint-disable-next-line no-useless-catch
    try {
      const ignore = await this.shouldIgnore_(data.id, "strapi")
      if (ignore) {
        console.log(
          "Strapi has just updated this product which triggered this function. IGNORING... "
        )
        return Promise.resolve()
      }

      let relations= [
        "options",
        "variants",
        "variants.prices",
        "variants.options",
        "type",
        "collection",
        "tags",
        "images",
      ]
      if(process.env.MEDUSA_FF_PRODUCT_CATEGORIES === "true"){
        relations.push("categories");
      }

      const product = await this.productService_.retrieve(data.id, {
        relations,
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
        ],
      })

      if (product) {
        const response = await this.updateEntryInStrapi("products", product.id, product)
        console.log("Product Strapi Id - ", response)

      }

      return product
    } catch (error) {
      throw error
    }
  }

  async updateProductVariantInStrapi(data) {
    const hasType = await this.getType("product-variants")
      .then((res) => {
        // console.log(res.data)
        return true
      })
      .catch((error) => {
        // console.log(error.response.status)
        return false
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
      })
      console.log(variant)

      if (variant) {
        // Update entry in Strapi
        const response = await this.updateEntryInStrapi(
          "product-variants",
          variant.id,
          variant
        )
        console.log("Variant Strapi Id - ", response)
      }

      return variant
    } catch (error) {
      console.log("Failed to update product variant", data.id)
      throw error
    }
  }

  async deleteProductInStrapi(data) {
    const hasType = await this.getType("products")
      .then(() => true)
      .catch((err) => {
        // console.log(err)
        return false
      })
    if (!hasType) {
      return Promise.resolve()
    }

    const ignore = await this.shouldIgnore_(data.id, "strapi")
    if (ignore) {
      return Promise.resolve()
    }

    return await this.deleteEntryInStrapi("products", data.id)
  }

  async deleteProductVariantInStrapi(data) {
    const hasType = await this.getType("product-variants")
      .then(() => true)
      .catch((err) => {
        // console.log(err)
        return false
      })
    if (!hasType) {
      return Promise.resolve()
    }

    const ignore = await this.shouldIgnore_(data.id, "strapi")
    if (ignore) {
      return Promise.resolve()
    }

    return await this.deleteEntryInStrapi("product-variants", data.id)
  }

  // Blocker - Delete Region API
  async deleteRegionInStrapi(data) {}

  async createProductCategoryInStrapi(productCategoryId) {
    const hasType = await this.getType("product-categories")
      .then(() => true)
      .catch(() => false)
    if (!hasType) {
      console.log('Type "product-categories" doesnt exist in Strapi')
      return Promise.resolve()
    }

    // eslint-disable-next-line no-useless-catch
    try {
      const productCategory = await this.productCategory_.retrieve(productCategoryId, {
        relations: [
          "parent_category",
        //   "category_children",
        ],
        select: ["id", "name", "description", "handle"],
      })
        
      const response = await this.createEntryInStrapi("product-categories", productCategoryId, productCategory);
      console.log("Product-Category Strapi Id - ", response);
      return response;
    } catch (error) {
      throw error
    }
  }

  async updateProductCategoryInStrapi(data) {
    const hasType = await this.getType("product-categories")
      .then((res) => {
        // console.log(res.data)
        return true
      })
      .catch((error) => {
        // console.log(error.response.status)
        return false
      })
    if (!hasType) {
      return Promise.resolve()
    }

    // eslint-disable-next-line no-useless-catch
    try {
      const ignore = await this.shouldIgnore_(data.id, "strapi")
      if (ignore) {
        return
      }

      const productCategory = await this.productCategory_.retrieve(data.id, {
        relations: [
          "parent_category",
          // "category_children",
        ],
        select: ["id", "name", "description", "handle"],
      })
      // console.log(region)

      if (productCategory) {
        // Update entry in Strapi
        const response = await this.updateEntryInStrapi(
          "product-categories",
          productCategory.id,
          productCategory
        )
        console.log("productCategory Strapi Id - ", response)
      }

      return productCategory
    } catch (error) {
      throw error
    }
  }

  async deleteProductCategoryInStrapi(data) {
    const hasType = await this.getType("product-categories")
      .then(() => true)
      .catch((err) => {
        // console.log(err)
        return false
      })
    if (!hasType) {
      return Promise.resolve()
    }

    const ignore = await this.shouldIgnore_(data.id, "strapi")
    if (ignore) {
      return Promise.resolve()
    }

    return await this.deleteEntryInStrapi("product-categories", data.id)
  }


  async createProductCollectionInStrapi(productCollectionId) {
    const hasType = await this.getType("product-collections")
      .then(() => true)
      .catch(() => false)
    if (!hasType) {
      console.log('Type "product-collections" doesnt exist in Strapi')
      return Promise.resolve()
    }

    // eslint-disable-next-line no-useless-catch
    try {
      const productCollection = await this.productCollection_.retrieve(productCollectionId, {
        select: ["id", "title", "handle"],
      })

      const response = await this.createEntryInStrapi("product-collections", productCollectionId, productCollection);
      console.log("Product Collection Strapi Id - ", response);
      return response;
    } catch (error) {
      throw error
    }
  }

  async updateProductCollectionInStrapi(data) {
    const hasType = await this.getType("product-collections")
      .then((res) => {
        // console.log(res.data)
        return true
      })
      .catch((error) => {
        // console.log(error.response.status)
        return false
      })
    if (!hasType) {
      return Promise.resolve()
    }

    // eslint-disable-next-line no-useless-catch
    try {
      const ignore = await this.shouldIgnore_(data.id, "strapi")
      if (ignore) {
        return
      }

      const productCollection = await this.productCollection_.retrieve(data.id, {
        select: ["id", "title", "handle"],
      })
      // console.log(region)

      if (productCollection) {
        // Update entry in Strapi
        const response = await this.updateEntryInStrapi(
          "product-collections",
          productCollection.id,
          productCollection
        )
        console.log("productCollection Strapi Id - ", response)
      }

      return productCollection
    } catch (error) {
      throw error
    }
  }

  async deleteProductCollectionInStrapi(data) {
    const hasType = await this.getType("product-collections")
      .then(() => true)
      .catch((err) => {
        // console.log(err)
        return false
      })
    if (!hasType) {
      return Promise.resolve()
    }

    const ignore = await this.shouldIgnore_(data.id, "strapi")
    if (ignore) {
      return Promise.resolve()
    }

    return await this.deleteEntryInStrapi("product-collections", data.id)
  }



  async updateProductsWithinCollectionInStrapi(data){
		const hasType = this.getType('product-collections')
			.then(() => {
				return true;
			})
			.catch(() => {
				return false;
			});
		if (!hasType) {
			return { status: 400 };
		}

		// const updateFields = ['productIds', 'productCollection'];

		// if (!this.verifyDataContainsFields(data, updateFields)) {
		// 	return { status: 400 };
		// }
		try {
			for (const productId of data.productIds) {
				const ignore = await this.shouldIgnore_(productId, 'strapi');
				if (ignore) {
					this.logger.info(
						'Strapi has just added this product to collection which triggered this function. IGNORING... '
					);
					continue;
				}

				const product = await this.productService_.retrieve(productId, {
					relations: ['collection'],
					select: ['id'],
				});

				if (product) {
				// 	// we're sending requests sequentially as the Strapi is having problems with deadlocks otherwise
				// 	await this.adjustProductAndUpdateInStrapi(product, data, authInterface);
        const response = await this.updateEntryInStrapi(
          "products",
          productId,
          product
        )
				}
			}
			// return { status: 200 };
		} catch (error) {
			this.logger.error('Error updating products in collection', error);
			throw error;
		}
		return { status: 400 };
	}


  async getType(type) {
    if (!this.strapiAuthToken) {
      await this.loginToStrapi()
    }
    const config = {
      url: `${this.strapi_URL_STRING}/api/${type}`,
      method: "get",
      headers: {
        Authorization: `Bearer ${this.strapiAuthToken}`,
      },
    }

    return axios(config)
  }

  async checkStrapiHealth() {
    const config = {
      method: "head",
      url: `${this.strapi_URL_STRING}/_health`,
    }
    console.log("Checking strapi Health")
    return axios(config)
      .then((res) => {
        if (res.status === 204) {
          console.log("\n Strapi Health Check OK \n")
        }
        return true
      })
      .catch((error) => {
        if (error.code === "ECONNREFUSED") {
          console.error(
            "\nCould not connect to strapi. Please make sure strapi is running.\n"
          )
        }
        return false
      })
  }

  async loginToStrapi() {
    const config = {
      method: "post",
      url: `${this.strapi_URL_STRING}/api/auth/local`,
      data: {
        identifier: this.options_.strapi_medusa_user,
        password: this.options_.strapi_medusa_password,
      },
    }
    return axios(config)
      .then((res) => {
        if (res.data.jwt) {
          this.strapiAuthToken = res.data.jwt
          console.log("\n Successfully logged in to Strapi \n")
          return true
        }
        return false
      })
      .catch((error) => {
        if (error) {
          throw new Error("\nError while trying to login to strapi\n"+error)
        }
      })
  }

  async createEntryInStrapi(type, id, data) {
    if (!this.strapiAuthToken) {
      await this.loginToStrapi()
    }
    const config = {
      method: "post",
      url: `${this.strapi_URL_STRING}/api/${type}`,
      headers: {
        Authorization: `Bearer ${this.strapiAuthToken}`,
      },
      data,
    }
    return axios(config)
      .then((res) => {
        if (res.data.id) {
          this.addIgnore_(id, "medusa")
          return res.data.id
        }
        return null
      })
      .catch(async (error) => {
        if (error && error.response && error.response.status) {
          throw new Error(
            "Error while trying to create entry in strapi - " + type
          )
        }
      })
  }

  async updateEntryInStrapi(type, id, data) {
    if (!this.strapiAuthToken) {
      await this.loginToStrapi()
    }
    const config = {
      method: "put",
      url: `${this.strapi_URL_STRING}/api/${type}/${id}`,
      headers: {
        Authorization: `Bearer ${this.strapiAuthToken}`,
      },
      data,
    }
    return axios(config)
      .then((res) => {
        if (res.data.id) {
          this.addIgnore_(id, "medusa")
          return res.data.id
        }
        return null
      })
      .catch(async (error) => {
        if (error && error.response && error.response.status) {
          throw new Error("Error while trying to update entry in strapi ")
        }
      })
  }

  async deleteEntryInStrapi(type, id) {
    if (!this.strapiAuthToken) {
      await this.loginToStrapi()
    }
    const config = {
      method: "delete",
      url: `${this.strapi_URL_STRING}/api/${type}/${id}`,
      headers: {
        Authorization: `Bearer ${this.strapiAuthToken}`,
      },
    }
    return axios(config)
      .then((res) => {
        if (res.data.result) {
          return res.data.data
        }
        return null
      })
      .catch(async (error) => {
        if (error && error.response && error.response.status) {
          throw new Error("Error while trying to delete entry in strapi ")
        }
      })
  }

  async doesEntryExistInStrapi(type, id) {
    if (!this.strapiAuthToken) {
      await this.loginToStrapi()
    }
    const config = {
      method: "get",
      url: `${this.strapi_URL_STRING}/api/${type}/${id}`,
      headers: {
        Authorization: `Bearer ${this.strapiAuthToken}`,
      },
    }

    return axios(config)
      .then((res) => {
        return true
      })
      .catch((error) => {
        console.log(error.response.status, id)
        throw new Error("Given entry doesn't exist in Strapi")
      })
  }
}

export default UpdateStrapiService
