import { formatRM } from '@jep/shared';

describe('config', () => {
  it('reads public env and trims a trailing slash from the API URL', () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://example.netlify.app/';
    process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID = 'jepventuresaccount';
    jest.isolateModules(() => {
      const { config } = require('./config');
      expect(config.apiBaseUrl).toBe('https://example.netlify.app');
      expect(config.firebase.projectId).toBe('jepventuresaccount');
    });
  });

  it('can import the shared workspace package', () => {
    expect(formatRM(15000)).toBe('RM 150.00');
  });
});
