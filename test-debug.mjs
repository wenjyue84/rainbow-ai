import { validateBookingStep } from './src/assistant/workflow-validator.js';

const result = validateBookingStep(
  {
    guest_age: 25,
    guest_phone: '+60123456789',
    guest_name: 'John Doe',
    check_in_date: '2026-05-15',
    check_out_date: '2026-05-20',
  },
  'pelangi'
);

console.log('Result:', JSON.stringify(result, null, 2));
