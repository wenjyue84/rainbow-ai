import { VM } from 'vm2';

const sandbox = {
  fieldValue: 25,
  ruleValue: 18,
  result: false,
};

const vm = new VM({
  timeout: 1000,
  sandbox,
});

const expression = 'result = fieldValue >= ruleValue;';
console.log('Executing:', expression);
console.log('Before:', sandbox);

try {
  vm.run(expression);
  console.log('After:', sandbox);
  console.log('Result:', sandbox.result);
} catch (err) {
  console.error('Error:', err);
}
