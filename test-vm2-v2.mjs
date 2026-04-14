import { VM } from 'vm2';

// Method 1: Try with wrapper object
const data = { result: false };
const sandbox = {
  fieldValue: 25,
  ruleValue: 18,
  data,
};

const vm = new VM({
  timeout: 1000,
  sandbox,
});

const expression = 'data.result = fieldValue >= ruleValue;';
console.log('Method 1 - wrapper object:');
console.log('Before:', data);
vm.run(expression);
console.log('After:', data);
console.log('Result:', data.result);
console.log('');

// Method 2: Try returning from a function
const sandbox2 = {
  fieldValue: 25,
  ruleValue: 18,
};

const vm2 = new VM({
  timeout: 1000,
  sandbox: sandbox2,
});

const expr2 = '(fieldValue >= ruleValue)';
console.log('Method 2 - expression result:');
try {
  const result = vm2.run(expr2);
  console.log('Direct result:', result);
} catch (err) {
  console.error('Error:', err);
}
