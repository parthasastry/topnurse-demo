import { Amplify } from 'aws-amplify';

/**
 * Configure Amplify with Cognito (wealth-ai-llc pattern).
 * Uses Vite env: VITE_USER_POOL_ID, VITE_USER_POOL_CLIENT_ID, VITE_AWS_REGION.
 */
const region = import.meta.env.VITE_AWS_REGION ?? 'us-west-1';
const userPoolId = import.meta.env.VITE_USER_POOL_ID;
const userPoolClientId = import.meta.env.VITE_USER_POOL_CLIENT_ID;

if (userPoolId && userPoolClientId) {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId,
        loginWith: {
          email: true,
        },
        signUpVerificationMethod: 'code',
        userAttributes: {
          email: { required: true },
        },
        passwordFormat: {
          minLength: 8,
          requireLowercase: true,
          requireUppercase: true,
          requireNumbers: true,
          requireSpecialCharacters: true,
        },
      },
    },
  });
} else {
  console.warn(
    'Amplify: VITE_USER_POOL_ID and VITE_USER_POOL_CLIENT_ID not set. Auth will be disabled.'
  );
}

export { region, userPoolId, userPoolClientId };
