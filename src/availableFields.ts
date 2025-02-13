import availableFieldsData from './availableFields.json';

export type ApiFields = {
  requiredFields: string[];
  outputFields: string[];
};

export type AvailableFieldsType = Record<string, ApiFields>;

export const availableFields: AvailableFieldsType = availableFieldsData;
