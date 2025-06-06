const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const twilio = require('twilio');
const app = express();
const port = process.env.PORT || 3000;

require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT
});

const AUTH_TOKEN = process.env.API_TOKEN;
const twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

app.use(bodyParser.json());

// Middleware for token-based auth
app.use((req, res, next) => {
  const token = req.headers['authorization'];
  if (token !== `Bearer ${AUTH_TOKEN}`) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
});

app.get('/api/billing/:customerId', async (req, res) => {
  const { customerId } = req.params;
  const result = await pool.query(
    'SELECT * FROM tbcloudbilling WHERE customerid = $1 ORDER BY billingdate DESC',
    [customerId]
  );
  res.json(result.rows);
});

app.get('/api/payment/:customerId', async (req, res) => {
  const { customerId } = req.params;
  const result = await pool.query(
    'SELECT * FROM tbcloudpayment WHERE customerid = $1 ORDER BY paymentdate DESC',
    [customerId]
  );
  res.json(result.rows);
});

app.post('/api/payment', async (req, res) => {
  const { customerid, amountpaid, paymentdate, phonenumber } = req.body;
  const paymentref = 'WAT' + Date.now();
  const sql = `
    INSERT INTO tbcloudpayment (customerid, amountpaid, paymentdate, updatedat, synced, paymentref)
    VALUES ($1, $2, $3, NOW(), false, $4) RETURNING *`;
  const result = await pool.query(sql, [customerid, amountpaid, paymentdate, paymentref]);

  if (phonenumber) {
    await twilioClient.messages.create({
      body: \`Payment of GHS \${amountpaid} received. Ref: \${paymentref}\`,
      from: process.env.TWILIO_NUMBER,
      to: phonenumber
    });
  }

  res.status(201).json({ message: 'Payment recorded', payment: result.rows[0] });
});

app.get('/api/balance/:customerId', async (req, res) => {
  const { customerId } = req.params;

  const totalBilling = await pool.query(
    'SELECT COALESCE(SUM(amount), 0) AS total FROM tbcloudbilling WHERE customerid = $1',
    [customerId]
  );

  const totalPayment = await pool.query(
    'SELECT COALESCE(SUM(amountpaid), 0) AS total FROM tbcloudpayment WHERE customerid = $1',
    [customerId]
  );

  const balance = totalBilling.rows[0].total - totalPayment.rows[0].total;

  res.json({
    customerId,
    totalBilled: totalBilling.rows[0].total,
    totalPaid: totalPayment.rows[0].total,
    balance
  });
});

app.listen(port, () => {
  console.log(`🔐 Secure Water Billing API running on http://localhost:${port}`);
});