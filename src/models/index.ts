/**
 * Barrel that guarantees every Mongoose model is registered before any query
 * runs. `connectToDatabase()` imports this module after connecting.
 */
export { Hospital, type HospitalDoc } from "@/models/Hospital";
export { User, type UserDoc } from "@/models/User";
export { Role, type RoleDoc } from "@/models/Role";
export { RefreshToken, type RefreshTokenDoc } from "@/models/RefreshToken";
export { AuditLog, type AuditLogDoc } from "@/models/AuditLog";
export { Department, type DepartmentDoc } from "@/models/Department";
export { Treatment, type TreatmentDoc } from "@/models/Treatment";
export { Counter, type CounterDoc } from "@/models/Counter";
export { Patient, type PatientDoc } from "@/models/Patient";
export { Doctor, type DoctorDoc } from "@/models/Doctor";
export {
  Appointment,
  type AppointmentDoc,
  type AppointmentStatus,
} from "@/models/Appointment";
export { Form, type FormDoc, type FormStatus } from "@/models/Form";
export { FormField, type FormFieldDoc, type FieldType } from "@/models/FormField";
export { FormResponse, type FormResponseDoc } from "@/models/FormResponse";
export { Visit, type VisitDoc } from "@/models/Visit";
export {
  Invoice,
  type InvoiceDoc,
  type InvoiceStatus,
  type DiscountType,
} from "@/models/Invoice";
export { Payment, type PaymentDoc, type PaymentMethod } from "@/models/Payment";
