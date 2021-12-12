<p align="center">
  <a href="https://www.medusa-commerce.com">
    <img alt="Medusa" src="https://user-images.githubusercontent.com/7554214/129161578-19b83dc8-fac5-4520-bd48-53cba676edd2.png" width="100" />
  </a>
  <a href="https://strapi.io/">
    <img alt="Medusa" src="https://images.opencollective.com/strapi/3ec3247/logo/256.png" width="100" />
  </a>
</p>
<h1 align="center">
  Medusa Strapi Plugin
</h1>

<p align="center">
  <a href="https://github.com/medusajs/medusa/blob/master/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="Medusa is released under the MIT license." />
  </a>
  <a href="https://github.com/medusajs/medusa/blob/master/CONTRIBUTING.md">
    <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat" alt="PRs welcome!" />
  </a>
  <a href="https://discord.gg/xpCwq3Kfn8">
    <img src="https://img.shields.io/badge/chat-on%20discord-7289DA.svg" alt="Discord Chat" />
  </a>
  <a href="https://twitter.com/intent/follow?screen_name=medusajs">
    <img src="https://img.shields.io/twitter/follow/medusajs.svg?label=Follow%20@medusajs" alt="Follow @medusajs" />
  </a>
</p>


## Setting up your store
- Initialize a `medusa` project by using a starter
  ```
  yarn create medusa-app
          OR
  npx create-medusa-app
  ```
- Choose `medusa-starter-default`
  ```
  ? Which Medusa starter would you like to install? …
  ❯ medusa-starter-default
    medusa-starter-contentful
    Other
  ```
- Pick any storefront starter
  ```
  Which storefront starter would you like to install? …
  ❯ Gatsby Starter
  Next.js Starter
  None
  ```
- Make sure `redis` is installed and running
  ``` 
  $ redis-cli
  127.0.0.1:6379> ping
  PONG
  ```
- Go to backend directory.
  ``` 
  cd <Your project name>/backend 
  ```
- Make sure your packages version in `package.json` match this - 
  ``` 
    "@medusajs/medusa": "^1.1.49",
    "@medusajs/medusa-cli": "^1.1.22",
    "medusa-fulfillment-manual": "^1.1.26",
    "medusa-interfaces": "^1.1.27",
    "medusa-payment-manual": "^1.0.8",
    "medusa-payment-stripe": "^1.1.30",
    "mongoose": "^5.13.3",
    "typeorm": "^0.2.36"
  ```

- Edit `medusa-config.js`. Navigate to the end of file and make sure this line is not commented out -
  ``` 
  redis_url: REDIS_URL,
  ```
- In the same file, add this object to plugins array -
  ```
  {
    resolve: `medusa-plugin-strapi`,
    options: {
    strapi_medusa_user: 'medusa_user',
    strapi_medusa_password: 'medusaPassword1',
    strapi_url: '127.0.0.1',
    strapi_port: '1337'
    }
  }
  ```
- Create and navigate to `plugins` directory and pull `medusa-plugin-strapi`
  ``` 
  cd plugins
  git clone https://github.com/Deathwish98/medusa-plugin-strapi.git
  ```

- Install dependencies and build project files
  ```
  cd medusa-plugin-strapi
  npm install
  npm run build
  ```
- Start medusa server from `backend` directory
  ``` 
  cd ../../
  npm run seed
  npm run start
  ```

Your local Medusa server should now be running on port **9000**. 

## Setting up strapi

This plugin assumes that you are familiar with strapi. If you have not used it before, visit the official docs for more info -

https://strapi.io/documentation/developer-docs/latest/getting-started/quick-start.html

- Create a new strapi project using our template. 
  ```
  npx create-strapi-app@3.6.8 strapi-medusa --template https://github.com/Deathwish98/strapi-medusa-template.git
  
  OR
  
  yarn create strapi-app strapi-medusa --template https://github.com/Deathwish98/strapi-medusa-template.git
  ```

- Start strapi server. 
  ``` 
  npm run develop <---- For development purposes
  
  OR 
  
  npm run start
  ```
  NOTE: If you are using `SQLite` there is a known `knex.js` bug -
  ``` 
  error KnexTimeoutError: Knex: Timeout acquiring a connection. The pool is probably full. Are you missing a .transacting(trx) call?
  ```
  It  appears after running `npm run develop` for the first time . Just run the command again and it should disappear. 

Visit [docs.medusa-commerce.com](https://docs.medusa-comerce.com) for further guides.

<p>
  <a href="https://www.medusa-commerce.com">
    Website
  </a> 
  |
  <a href="https://medusajs.notion.site/medusajs/Medusa-Home-3485f8605d834a07949b17d1a9f7eafd">
    Notion Home
  </a>
  |
  <a href="https://twitter.com/intent/follow?screen_name=medusajs">
    Twitter
  </a>
  |
  <a href="https://docs.medusa-commerce.com">
    Docs
  </a>
</p>
