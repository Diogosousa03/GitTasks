const { newEnforcer } = require('casbin');

const pdp = async function(s, o, a) {
  const enforcer = await newEnforcer('casbin/model.conf', 'casbin/policy.csv');
  r = await enforcer.enforce(s, o, a);
  return {res: r, sub: s, obj: o, act: a};
}


const pep = function(decision) {
  console.log(decision);
  if (decision.res == true) {
    console.log("permit operation")
  } else {
    console.log("deny operation")
  }  
}
module.exports = { pdp, pep };