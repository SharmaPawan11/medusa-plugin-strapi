import { BaseService } from "medusa-interfaces"
import { addIgnore_, shouldIgnore_ } from "../utils/redis-key-manager"

function isEmptyObject(obj) {
  // eslint-disable-next-line guard-for-in
  for (const i in obj) {
    return false
  }
  return true
}

class UpdateMedusaService extends BaseService {
  constructor({
    productService,
    productVariantService,
    regionService,
    redisClient,
    productCategoryService,
    productCollectionService
  }) {
    super()

    this.productService_ = productService
    this.productVariantService_ = productVariantService
    this.redisClient_ = redisClient
    this.regionService_ = regionService
    this.productCategoryService_ = productCategoryService
    this.productCollectionService_ = productCollectionService
  }

  async sendStrapiProductVariantToMedusa(variantEntry, variantId) {
    const ignore = await shouldIgnore_(variantId, "medusa", this.redisClient_)
    if (ignore) {
      return
    }

    try {
      const variant = await this.productVariantService_.retrieve(variantId)
      const update = {}

      if (variant.title !== variantEntry.title) {
        update.title = variantEntry.title
      }

      if (!isEmptyObject(update)) {
        const updatedVariant = await this.productVariantService_
          .update(variantId, update)
          .then(async () => {
            return await addIgnore_(variantId, "strapi", this.redisClient_)
          })

        return updatedVariant
      }
    } catch (error) {
      console.log(error)
      return false
    }
  }

  async sendStrapiProductToMedusa(productEntry, productId) {
    const ignore = await shouldIgnore_(productId, "medusa", this.redisClient_)
    if (ignore) {
      return
    }

    try {
      // get entry from Strapi
      // const productEntry = null

      const product = await this.productService_.retrieve(productId)

      const update = {}

      // update Medusa product with Strapi product fields
      const title = productEntry.title
      const subtitle = productEntry.subtitle
      const description = productEntry.description
      const handle = productEntry.handle
      const thumbnail = productEntry.thumbnail

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

      if (product.thumbnail !== thumbnail) {
        update.thumbnail = thumbnail
      }

      if (!isEmptyObject(update)) {
        await this.productService_.update(productId, update).then(async () => {
          return await addIgnore_(productId, "strapi", this.redisClient_)
        })
      }
    } catch (error) {
      console.log(error)
      return false
    }
  }

  async sendStrapiRegionToMedusa(regionEntry, regionId) {
    const ignore = await shouldIgnore_(regionId, "medusa", this.redisClient_)
    if (ignore) {
      return
    }

    try {
      const region = await this.regionService_.retrieve(regionId)
      const update = {}

      if (region.name !== regionEntry.name) {
        update.name = regionEntry.name
      }

      if (!isEmptyObject(update)) {
        const updatedRegion = await this.regionService_
          .update(regionId, update)
          .then(async () => {
            return await addIgnore_(regionId, "strapi", this.redisClient_)
          })
        return updatedRegion
      }
    } catch (error) {
      console.log(error)
      return false
    }
  }

  async sendStrapiProductCategoryToMedusa(productCategoryEntry, productCategoryId) {
    const ignore = await shouldIgnore_(productCategoryId, "medusa", this.redisClient_)
    if (ignore) {
      return
    }

    try {
      const productCategory = await this.productCategoryService_.retrieve(productCategoryId)

      const update = {}

      const name = productCategoryEntry.name
      const description = productCategoryEntry.description
      const handle = productCategoryEntry.handle

      if (productCategory.name !== name) {
        update.name = name
      }

      if (productCategory.description !== description) {
        update.description = description
      }

      if (productCategory.handle !== handle) {
        update.handle = handle
      }

      if (!isEmptyObject(update)) {
        await this.productCategoryService_.update(productCategoryId, update).then(async () => {
          return await addIgnore_(productCategoryId, "strapi", this.redisClient_)
        })
      }
    } catch (error) {
      console.log(error)
      return false
    }
  }

  async sendStrapiProductCollectionToMedusa(productCollectionEntry, productCollectionId) {
    const ignore = await shouldIgnore_(productCollectionId, "medusa", this.redisClient_)
    if (ignore) {
      return
    }

    try {
      const productCollection = await this.productCollectionService_.retrieve(productCollectionId)

      const update = {}
      const title = productCollectionEntry.title
      const handle = productCollectionEntry.handle

      if (productCollection.title !== title) {
        update.title = title
      }

      if (productCollection.handle !== handle) {
        update.handle = handle
      }

      if (!isEmptyObject(update)) {
        await this.productCollectionService_.update(productCollectionId, update).then(async () => {
          return await addIgnore_(productCollectionId, "strapi", this.redisClient_)
        })
      }
    } catch (error) {
      console.log(error)
      return false
    }
  }
}

export default UpdateMedusaService
