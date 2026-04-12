const bcrypt = require('bcryptjs');

async function createTestUser() {
  const password = 'testpassword123';
  const passwordHash = await bcrypt.hash(password, 10);
  
  console.log('Password:', password);
  console.log('Hash:', passwordHash);
  
  // Для SQLite команды
  console.log('\nSQL command:');
  console.log(`UPDATE users SET password_hash = '${passwordHash}' WHERE email = 'test@soundspa.com';`);
}

createTestUser().catch(console.error);