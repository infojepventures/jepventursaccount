import { config } from '../config';
import { createApi } from './api';
import { auth } from './firebase';

export const api = createApi({
  baseUrl: config.apiBaseUrl,
  getIdToken: async () => (auth.currentUser ? auth.currentUser.getIdToken() : null),
});
