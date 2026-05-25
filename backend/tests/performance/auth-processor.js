module.exports = {
  getAuthToken: async (context, events, done) => {
    const axios = require('axios');
    try {
      const loginRes = await axios.post('http://localhost:3000/api/auth/login', {
        phone: '+79991234567',
        password: 'test1234'
      });
      const code = loginRes.data.dev_code;
      const verifyRes = await axios.post('http://localhost:3000/api/auth/verify', {
        phone: '+79991234567',
        code: code
      });
      context.vars.token = verifyRes.data.access_token;
      done();
    } catch (err) {
      console.error('Auth failed', err.message);
      done(err);
    }
  }
};
