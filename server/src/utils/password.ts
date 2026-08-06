/**
 * Password hashing.
 *
 * bcryptjs (pure JavaScript) rather than the native `bcrypt` binding: it removes a
 * node-gyp build step from every install and deploy, at the cost of being slower per hash.
 * At a work factor of 12 that is roughly a quarter-second, which is fine for a login
 * endpoint and irrelevant everywhere else. Native bcrypt or argon2id is the upgrade if
 * login throughput ever matters — noted in the README.
 */

import bcrypt from 'bcryptjs';

import { env } from '../config/env.ts';

export const hashPassword = (plain: string): Promise<string> =>
  bcrypt.hash(plain, env.BCRYPT_ROUNDS);

export const verifyPassword = (plain: string, hash: string): Promise<boolean> =>
  bcrypt.compare(plain, hash);

/**
 * Burn comparable CPU to a real verification when the account does not exist.
 *
 * Without this, "unknown email" returns in ~1ms while "wrong password" takes ~250ms, and
 * that timing difference alone tells an attacker which emails are registered — defeating
 * the point of the deliberately vague error message.
 */
const DUMMY_HASH = '$2b$12$6Ra.qnLuIJ/VU.hfC9DO7eUMi/GjiDXrqnDzuHB0Myl9KLTEdj5lO';

export const wasteTimeLikeAVerification = async (): Promise<void> => {
  await bcrypt.compare('not-the-real-password', DUMMY_HASH);
};
