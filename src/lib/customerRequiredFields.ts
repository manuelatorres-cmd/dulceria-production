/**
 * Required-fields computation for customers — used by both the list
 * page's warning dot and the detail page's banner.
 *
 * Per spec: name/company, type, contact person, phone, email, default
 * fulfilment. Missing fields never block a save; they're just flagged.
 */

export interface MinimalCustomer {
  companyName?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  type?: string;
  defaultDeliveryMethod?: string;
}

export function computeMissingRequiredCustomerFields(customer: MinimalCustomer): string[] {
  const missing: string[] = [];
  if (!customer.companyName?.trim()) missing.push("name");
  if (!customer.type) missing.push("type");
  if (!customer.contactName?.trim()) missing.push("contact");
  if (!customer.phone?.trim()) missing.push("phone");
  if (!customer.email?.trim()) missing.push("email");
  if (!customer.defaultDeliveryMethod) missing.push("fulfilment");
  return missing;
}
