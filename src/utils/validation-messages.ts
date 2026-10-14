import { BadRequestException, ValidationError } from '@nestjs/common';

/**
 * Thai validation messages (D-05, 2026-10-14).
 *
 * class-validator answers in English ("reason should not be empty"). The
 * ValidationPipe in main.ts uses `thaiValidationExceptionFactory` so every DTO
 * error reaches the user in Thai without a message on each decorator. A
 * decorator that already has its own Thai `message` keeps it.
 */

/** Thai names of the DTO fields. A field not listed here shows its own name. */
export const FIELD_LABELS: Record<string, string> = {
  action: 'การดำเนินการ',
  advanceNoticeDays: 'จำนวนวันที่ต้องแจ้งล่วงหน้า',
  captchaCode: 'รหัส CAPTCHA',
  captchaId: 'รหัสอ้างอิง CAPTCHA',
  captchaInput: 'รหัส CAPTCHA',
  code: 'รหัส',
  comment: 'ความคิดเห็น',
  currentAddress: 'ที่อยู่ปัจจุบัน',
  currentPassword: 'รหัสผ่านปัจจุบัน',
  date: 'วันที่',
  dateOfBirth: 'วันเกิด',
  defaultDays: 'จำนวนวันลาเริ่มต้น',
  departmentId: 'แผนก',
  email: 'อีเมล',
  employeeCode: 'รหัสพนักงาน',
  endDate: 'วันที่สิ้นสุด',
  endFormat: 'รูปแบบวันที่สิ้นสุด',
  endTime: 'เวลาสิ้นสุด',
  firstName: 'ชื่อ',
  firstNameEN: 'ชื่อ (ภาษาอังกฤษ)',
  gender: 'เพศ',
  hireDate: 'วันที่เริ่มงาน',
  hours: 'จำนวนชั่วโมง',
  idCardAddress: 'ที่อยู่ตามบัตรประชาชน',
  idCardNumber: 'เลขบัตรประชาชน',
  isActive: 'สถานะการใช้งาน',
  isImportant: 'ประกาศสำคัญ',
  isSpecial: 'ประเภทลาพิเศษ',
  key: 'ชื่อการตั้งค่า',
  lastName: 'นามสกุล',
  lastNameEN: 'นามสกุล (ภาษาอังกฤษ)',
  leaveDate: 'วันที่ลา',
  leaveHours: 'จำนวนชั่วโมงลา',
  leaveMode: 'รูปแบบการลา',
  leaveTypeId: 'ประเภทการลา',
  limit: 'จำนวนรายการต่อหน้า',
  minTenureDays: 'อายุงานขั้นต่ำ (วัน)',
  name: 'ชื่อ',
  newPassword: 'รหัสผ่านใหม่',
  page: 'หน้า',
  password: 'รหัสผ่าน',
  period: 'ช่วงเวลา',
  phone: 'เบอร์โทรศัพท์',
  positionId: 'ตำแหน่ง',
  reason: 'เหตุผล',
  remainingDays: 'วันลาคงเหลือ',
  requiresCertificate: 'การแนบใบรับรอง',
  roleId: 'สิทธิ์การใช้งาน',
  roleName: 'สิทธิ์การใช้งาน',
  search: 'คำค้นหา',
  settings: 'การตั้งค่า',
  startDate: 'วันที่เริ่มต้น',
  startFormat: 'รูปแบบวันที่เริ่มต้น',
  startTime: 'เวลาเริ่มต้น',
  status: 'สถานะ',
  subtitle: 'รายละเอียด',
  title: 'หัวข้อ',
  token: 'โทเคน',
  totalDays: 'จำนวนวัน',
  username: 'ชื่อผู้ใช้',
  value: 'ค่า',
};

const THAI = /[\u0E00-\u0E7F]/;

export function fieldLabel(property: string): string {
  return FIELD_LABELS[property] ?? property;
}

/** The number at the end of messages like "x must not be less than 0". */
function trailingNumber(text: string): string {
  return /(-?\d+(?:\.\d+)?)\D*$/.exec(text)?.[1] ?? '';
}

/** One Thai message for one failed constraint of one field. */
export function thaiConstraintMessage(
  constraint: string,
  property: string,
  original: string,
): string {
  if (THAI.test(original)) return original; // the DTO already has a Thai message
  const f = fieldLabel(property);
  switch (constraint) {
    case 'isNotEmpty':
    case 'isDefined':
      return `กรุณากรอก${f}`;
    case 'isString':
      return `${f}ต้องเป็นข้อความ`;
    case 'isDateString':
    case 'isISO8601':
    case 'isDate':
      return `${f}ไม่ใช่วันที่ที่ถูกต้อง`;
    case 'isEmail':
      return `รูปแบบ${f}ไม่ถูกต้อง`;
    case 'isInt':
      return `${f}ต้องเป็นจำนวนเต็ม`;
    case 'isNumber':
      return `${f}ต้องเป็นตัวเลข`;
    case 'isBoolean':
      return `${f}ต้องเป็นค่าจริงหรือเท็จ`;
    case 'min':
      return `${f}ต้องไม่น้อยกว่า ${trailingNumber(original)}`;
    case 'max':
      return `${f}ต้องไม่มากกว่า ${trailingNumber(original)}`;
    case 'minLength':
      return `${f}ต้องมีอย่างน้อย ${trailingNumber(original.replace(/characters?$/, ''))} ตัวอักษร`;
    case 'maxLength':
      return `${f}ต้องไม่เกิน ${trailingNumber(original.replace(/characters?$/, ''))} ตัวอักษร`;
    case 'isArray':
      return `${f}ต้องเป็นรายการ`;
    case 'isIn':
    case 'isEnum':
      return `${f}มีค่าที่ไม่รองรับ`;
    case 'whitelistValidation':
      return `ไม่อนุญาตให้ส่งข้อมูล "${property}"`;
    default:
      return `${f}ไม่ถูกต้อง`;
  }
}

/** All messages of a validation result, nested objects included, in field order. */
export function thaiValidationMessages(errors: ValidationError[]): string[] {
  const out: string[] = [];
  for (const error of errors) {
    for (const [constraint, original] of Object.entries(
      error.constraints ?? {},
    )) {
      out.push(thaiConstraintMessage(constraint, error.property, original));
    }
    if (error.children?.length) {
      out.push(...thaiValidationMessages(error.children));
    }
  }
  return out;
}

/** `exceptionFactory` for ValidationPipe: the same 400 Nest sends, with Thai messages. */
export function thaiValidationExceptionFactory(
  errors: ValidationError[],
): BadRequestException {
  return new BadRequestException(thaiValidationMessages(errors));
}
