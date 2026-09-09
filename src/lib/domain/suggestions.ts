/**
 * Autocomplete suggestions for free-text configuration fields.
 *
 * These are HINTS ONLY — every field that uses them still accepts anything
 * typed. Departments and specialisations are tenant configuration (Sections 17
 * and 39): a hospital defines whatever it actually runs, and this list must
 * never become a fixed set of options.
 *
 * Adding to it changes what is offered, never what is allowed.
 */

export const DEPARTMENT_SUGGESTIONS: readonly string[] = [
  "Anaesthesiology",
  "Cardiology",
  "Dentistry",
  "Dermatology",
  "Emergency",
  "Endocrinology",
  "ENT (Otolaryngology)",
  "Gastroenterology",
  "General Medicine",
  "General Surgery",
  "Gynaecology",
  "Haematology",
  "Intensive Care",
  "Nephrology",
  "Neurology",
  "Neurosurgery",
  "Nutrition & Dietetics",
  "Obstetrics",
  "Oncology",
  "Ophthalmology",
  "Orthopaedics",
  "Paediatrics",
  "Pathology",
  "Pharmacy",
  "Physiotherapy",
  "Plastic Surgery",
  "Psychiatry",
  "Pulmonology",
  "Radiology",
  "Rheumatology",
  "Urology",
] as const;

/**
 * Offered under a patient's emergency contact. Free text still: "Guardian",
 * "Neighbour" and every family term this list does not carry must remain
 * typeable.
 */
export const RELATIONSHIP_SUGGESTIONS: readonly string[] = [
  "Spouse",
  "Husband",
  "Wife",
  "Father",
  "Mother",
  "Son",
  "Daughter",
  "Brother",
  "Sister",
  "Grandfather",
  "Grandmother",
  "Uncle",
  "Aunt",
  "Cousin",
  "Nephew",
  "Niece",
  "Father-in-law",
  "Mother-in-law",
  "Son-in-law",
  "Daughter-in-law",
  "Guardian",
  "Friend",
  "Neighbour",
  "Colleague",
  "Carer",
] as const;

export const SPECIALISATION_SUGGESTIONS: readonly string[] = [
  "Anaesthetist",
  "Cardiologist",
  "Dentist",
  "Dermatologist",
  "Endocrinologist",
  "ENT Surgeon",
  "Gastroenterologist",
  "General Physician",
  "General Surgeon",
  "Gynaecologist",
  "Haematologist",
  "Nephrologist",
  "Neurologist",
  "Neurosurgeon",
  "Obstetrician",
  "Oncologist",
  "Ophthalmologist",
  "Orthopaedic Surgeon",
  "Paediatrician",
  "Pathologist",
  "Physiotherapist",
  "Plastic Surgeon",
  "Psychiatrist",
  "Pulmonologist",
  "Radiologist",
  "Rheumatologist",
  "Urologist",
] as const;
