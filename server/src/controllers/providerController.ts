/**
 * Provider catalogue — what a customer can browse and book against.
 */

import type { Request, Response } from 'express';

import type { ProviderListQuery } from '@shared/schemas.ts';

import { pool } from '../db/pool.ts';
import providerRepository from '../repositories/providerRepository.ts';
import { sendData } from '../utils/httpResponse.ts';

export const list = async (req: Request, res: Response): Promise<void> => {
  const queryParams = req.query as unknown as ProviderListQuery;

  // Scoped to the caller's tenant, from the token — not from a query parameter.
  const providers = await providerRepository.listActive(
    pool,
    req.auth!.businessId,
    queryParams.specialty,
  );

  sendData(res, { providers });
};

export const specialties = async (req: Request, res: Response): Promise<void> => {
  const values = await providerRepository.listSpecialties(pool, req.auth!.businessId);
  sendData(res, { specialties: values });
};

export default { list, specialties };
