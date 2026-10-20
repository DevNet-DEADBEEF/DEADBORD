/** Every login method, in the order of the Login Methods page. */

import bank from './bank';
import billing_address from './billing_address';
import birthday from './birthday';
import blood_type from './blood_type';
import chatgpt from './chatgpt';
import coordinates from './coordinates';
import credit_card from './credit_card';
import debit_card from './debit_card';
import discord from './discord';
import email from './email';
import favorite_color from './favorite_color';
import favorite_number from './favorite_number';
import google from './google';
import gov_id from './gov_id';
import lucky from './lucky';
import microsoft from './microsoft';
import paragraph from './paragraph';
import password from './password';
import phone from './phone';
import pin from './pin';
import reaction_time from './reaction_time';
import roblox from './roblox';
import security_question from './security_question';
import slider from './slider';
import sso from './sso';
import username from './username';
import type { LoginMethod } from './types';

export type { AuthMode, LoginMethod } from './types';

export const LOGIN_METHODS: LoginMethod[] = [
  lucky,
  username,
  password,
  google,
  microsoft,
  chatgpt,
  discord,
  roblox,
  sso,
  email,
  phone,
  billing_address,
  gov_id,
  favorite_color,
  pin,
  security_question,
  credit_card,
  debit_card,
  bank,
  blood_type,
  birthday,
  favorite_number,
  paragraph,
  slider,
  coordinates,
  reaction_time,
];
