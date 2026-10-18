import 'reflect-metadata';

// Tests never read the developer's .env; each test builds the environment it needs.
process.env.NODE_ENV = 'test';
