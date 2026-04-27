const fs = require('fs');
const path = require('path');

class Logger {
  constructor() {
    this.logDir = path.join(__dirname, '../logs');
    this.ensureLogDir();
  }

  ensureLogDir() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  log(level, message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;
    
    // Console output
    console.log(logMessage);
    
    // File output
    const logFile = path.join(this.logDir, `${level.toLowerCase()}.log`);
    try {
      fs.appendFileSync(logFile, logMessage);
    } catch (e) {
      console.error('Error writing to log file:', e);
    }
  }

  info(message) {
    this.log('INFO', message);
  }

  warn(message) {
    this.log('WARN', message);
  }

  error(message) {
    this.log('ERROR', message);
  }

  debug(message) {
    if (process.env.DEBUG === 'true') {
      this.log('DEBUG', message);
    }
  }
}

module.exports = new Logger();
