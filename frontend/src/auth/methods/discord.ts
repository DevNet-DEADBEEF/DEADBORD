import { DiscordIcon } from './brandIcons';
import { oauthMethod } from './types';

/** Login with Discord: OAuth2, handled by the server (backend/src/auth/oauth.ts). */
export default oauthMethod('discord', 'Discord', DiscordIcon);
