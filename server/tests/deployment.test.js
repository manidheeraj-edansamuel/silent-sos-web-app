import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSslConfig,
  buildConnectionConfig,
  describeDatabaseTarget,
} from '../src/config/database.js';
import { getAllowedOrigins, isOriginAllowed } from '../src/config/origins.js';

describe('Deployment configuration', () => {
  test('1. Loopback database targets do not use TLS', () => {
    assert.equal(resolveSslConfig({ DATABASE_HOST: 'localhost' }), false);
    assert.equal(
      resolveSslConfig({ DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/db' }),
      false
    );
  });

  test('2. Managed database targets enable certificate-verified TLS', () => {
    assert.deepEqual(
      resolveSslConfig({ DATABASE_URL: 'postgresql://u:p@ep-x-y.neon.tech/db' }),
      { rejectUnauthorized: true }
    );
    assert.deepEqual(resolveSslConfig({ DATABASE_HOST: 'db.internal.example' }), {
      rejectUnauthorized: true,
    });
  });

  test('3. DATABASE_SSL overrides automatic detection', () => {
    assert.equal(
      resolveSslConfig({
        DATABASE_SSL: 'false',
        DATABASE_URL: 'postgresql://u:p@ep-x-y.neon.tech/db',
      }),
      false
    );
    assert.deepEqual(resolveSslConfig({ DATABASE_SSL: 'no-verify' }), {
      rejectUnauthorized: false,
    });
    assert.deepEqual(resolveSslConfig({ DATABASE_SSL: 'true', DATABASE_HOST: 'localhost' }), {
      rejectUnauthorized: true,
    });
  });

  test('4. DATABASE_URL takes precedence over discrete variables', () => {
    const config = buildConnectionConfig({
      env: {
        DATABASE_URL: 'postgresql://user:secret@db.example.test:5432/app',
        DATABASE_HOST: 'localhost',
        DATABASE_NAME: 'ignored',
      },
    });

    assert.equal(config.connectionString, 'postgresql://user:secret@db.example.test:5432/app');
    assert.equal(config.host, undefined);
    assert.equal(config.database, undefined);
    assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  });

  test('5. Discrete variables still build the local connection config', () => {
    const config = buildConnectionConfig({
      database: 'silent_sos_test',
      env: {
        DATABASE_HOST: 'localhost',
        DATABASE_PORT: '5433',
        DATABASE_USER: 'tester',
        DATABASE_PASSWORD: 'local-password',
      },
    });

    assert.equal(config.host, 'localhost');
    assert.equal(config.port, 5433);
    assert.equal(config.database, 'silent_sos_test');
    assert.equal(config.user, 'tester');
    assert.equal(config.password, 'local-password');
    assert.equal(config.ssl, undefined);
  });

  test('6. Log target description never includes credentials', () => {
    const description = describeDatabaseTarget({
      DATABASE_URL: 'postgresql://user:supersecret@db.example.test:5432/app',
    });

    assert.equal(description, 'db.example.test:5432/app');
    assert.ok(!description.includes('supersecret'));
    assert.ok(!description.includes('user'));
  });

  test('7. The hosted public URL is always an allowed origin', () => {
    const env = {
      PORT: '5000',
      CORS_ORIGIN: 'http://localhost:5173',
      RENDER_EXTERNAL_URL: 'https://silent-sos.onrender.com/',
    };

    assert.ok(getAllowedOrigins(env).includes('https://silent-sos.onrender.com'));
    assert.equal(isOriginAllowed('https://silent-sos.onrender.com', env), true);
  });

  test('8. Unknown browser origins remain rejected', () => {
    const env = {
      PORT: '5000',
      CORS_ORIGIN: 'http://localhost:5173',
      RENDER_EXTERNAL_URL: 'https://silent-sos.onrender.com',
    };

    assert.equal(isOriginAllowed('https://evil.example', env), false);
    // Non-browser clients send no Origin header.
    assert.equal(isOriginAllowed(undefined, env), true);
  });
});
