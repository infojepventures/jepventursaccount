import { routeFor } from './routeFor';

describe('routeFor', () => {
  it('waits while loading', () => {
    expect(routeFor({ status: 'loading', profileComplete: false }, 'login')).toBeNull();
  });
  it('sends signed-out users to login', () => {
    expect(routeFor({ status: 'signedOut', profileComplete: false }, '(tabs)')).toBe('/login');
    expect(routeFor({ status: 'signedOut', profileComplete: false }, 'login')).toBeNull();
  });
  it('sends users with incomplete profiles to setup', () => {
    expect(routeFor({ status: 'signedIn', profileComplete: false }, '(tabs)')).toBe('/profile-setup');
    expect(routeFor({ status: 'signedIn', profileComplete: false }, 'profile-setup')).toBeNull();
  });
  it('moves ready users out of login and setup', () => {
    expect(routeFor({ status: 'signedIn', profileComplete: true }, 'login')).toBe('/');
    expect(routeFor({ status: 'signedIn', profileComplete: true }, 'profile-setup')).toBe('/');
    expect(routeFor({ status: 'signedIn', profileComplete: true }, 'claim')).toBeNull();
  });
});
