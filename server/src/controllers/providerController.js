/**
 * Provider catalogue — what a customer can browse and book against.
 */

import { pool } from '../db/pool.js';
import providerRepository from '../repositories/providerRepository.js';
import { sendData } from '../utils/httpResponse.js';

export const list = async (req, res) => {
  const queryParams = req.query;

  // Scoped to the caller's tenant, from the token — not from a query parameter.
  const providers = await providerRepository.listActive(
    pool,
    req.auth.businessId,
    queryParams.specialty,
  );

  sendData(res, { providers });
};

export const specialties = async (req, res) => {
  const values = await providerRepository.listSpecialties(pool, req.auth.businessId);
  sendData(res, { specialties: values });
};

export default { list, specialties };
