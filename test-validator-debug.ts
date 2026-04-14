import { validateBookingStep } from './src/assistant/workflow-validator.js';

const bookingData = {
  guest_name: 'John Smith',
  guest_phone: '+60123456789',
  guest_email: 'john@example.com',
  guest_age: 28,
  check_in_date: '2026-06-15',
  check_out_date: '2026-06-20',
  room_type: 'Deluxe',
  special_requests: 'High floor preferred',
};

const result = validateBookingStep(bookingData, 'pelangi');
console.log('Valid:', result.valid);
console.log('Errors:', result.errors);
