// src/availableFields.ts
import availableFieldsData from './availableFields.json';

export type AvailableFieldsType = Record<string, string[]>;
export const availableFields: AvailableFieldsType = availableFieldsData;
