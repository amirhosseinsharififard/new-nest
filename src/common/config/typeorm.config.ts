import { registerAs } from '@nestjs/config';
import { DataSource, DataSourceOptions } from 'typeorm';

export const typeOrmConfig = registerAs(
  'database',
  (): DataSourceOptions => ({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    entities: [__dirname + '/../../**/*.entity{.ts,.js}'],
    migrations: [__dirname + '/../../migrations/*{.ts,.js}'],
    synchronize: false, // هرگز true نشه، حتی در dev — همیشه از migration استفاده کن
    logging: process.env.NODE_ENV === 'development',
  }),
);

// برای استفاده مستقیم توسط TypeORM CLI (migration:generate/run)
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  entities: [__dirname + '/../../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../../migrations/*{.ts,.js}'],
});
