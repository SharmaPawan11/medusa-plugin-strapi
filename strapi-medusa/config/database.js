module.exports = ({ env }) => ({
  defaultConnection: 'default',
  connections: {
    default: {
      connector: 'bookshelf',
      settings: {

        /* FOR SQLITE */
        // client: 'sqlite',
        // filename: env('DATABASE_FILENAME', '.tmp/data.db'),

        /* FOR POSTGRES */
        client: 'postgres',
        host: env('DATABASE_HOST', '127.0.0.1'),
        port: env.int('DATABASE_PORT', 5432),
        database: env('DATABASE_NAME', 'medusa'),
        username: env('DATABASE_USERNAME', 'medusa'),
        password: env('DATABASE_PASSWORD', 'medusa'),
        ssl: env.bool('DATABASE_SSL', false),
      },
      options: {},
    },
  },
});
