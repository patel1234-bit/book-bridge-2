/**
 * ==========================================================================
 * BOOKBRIDGE VALIDATION MIDDLEWARE
 * Request payload validation and sanitization for Books, Auth, and Messages
 * ==========================================================================
 */

/**
 * Validates and formats Indian mobile numbers (+91XXXXXXXXXX)
 */
function validateAndFormatWhatsAppNumber(num) {
  if (num === undefined || num === null || String(num).trim() === '') {
    return { valid: true, formatted: '' };
  }
  let raw = String(num).trim().replace(/[\s\-\(\)]/g, '');
  if (raw.startsWith('+91')) {
    raw = raw.slice(3);
  } else if (raw.startsWith('91') && raw.length === 12) {
    raw = raw.slice(2);
  } else if (raw.startsWith('0') && raw.length === 11) {
    raw = raw.slice(1);
  }

  if (!/^[6-9]\d{9}$/.test(raw)) {
    return { valid: false, error: 'Invalid WhatsApp number. Must be a valid 10-digit Indian mobile number starting with 6-9.' };
  }
  return { valid: true, formatted: `+91${raw}` };
}

exports.validateAndFormatWhatsAppNumber = validateAndFormatWhatsAppNumber;

/**
 * Validates book creation payload
 */
exports.validateBookInput = (req, res, next) => {
  const { title, author, semester, branch, mode, price, condition } = req.body;
  const errors = [];

  if (!title || typeof title !== 'string' || title.trim().length < 2) {
    errors.push('Title is required and must be at least 2 characters long.');
  }

  if (!author || typeof author !== 'string' || author.trim().length < 2) {
    errors.push('Author is required and must be at least 2 characters long.');
  }

  if (mode) {
    const validModes = ['sell', 'exchange', 'donate', 'buy'];
    if (!validModes.includes(String(mode).toLowerCase())) {
      errors.push(`Mode must be one of: ${validModes.join(', ')}.`);
    }

    if (String(mode).toLowerCase() === 'sell') {
      const numPrice = parseFloat(price);
      if (isNaN(numPrice) || numPrice < 0) {
        errors.push('Selling price must be a non-negative number.');
      }
    }
  }

  if (semester !== undefined && semester !== null && semester !== '') {
    const semNum = parseInt(semester, 10);
    if (isNaN(semNum) || semNum < 1 || semNum > 8) {
      errors.push('Semester must be an integer between 1 and 8.');
    }
  }

  if (condition) {
    const validConditions = ['Brand New', 'Like New', 'Excellent', 'Good', 'Fair'];
    const matches = validConditions.some(c => c.toLowerCase() === String(condition).toLowerCase());
    if (!matches) {
      errors.push(`Condition must be one of: ${validConditions.join(', ')}.`);
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({
      error: errors[0],
      errors,
      status: 400
    });
  }

  // Sanitize values
  req.body.title = title.trim();
  req.body.author = author.trim();
  if (req.body.mode) req.body.mode = String(mode).toLowerCase();
  if (req.body.price !== undefined) req.body.price = parseFloat(req.body.price) || 0;
  if (req.body.semester) req.body.semester = parseInt(req.body.semester, 10);

  next();
};

/**
 * Validates book partial update payload (e.g. marking Reserved or Sold)
 */
exports.validateBookUpdate = (req, res, next) => {
  const { title, author, semester, mode, price, condition, status } = req.body;
  const errors = [];

  if (title !== undefined && (typeof title !== 'string' || title.trim().length < 2)) {
    errors.push('Title must be at least 2 characters long.');
  }

  if (author !== undefined && (typeof author !== 'string' || author.trim().length < 2)) {
    errors.push('Author must be at least 2 characters long.');
  }

  if (mode !== undefined) {
    const validModes = ['sell', 'exchange', 'donate', 'buy'];
    if (!validModes.includes(String(mode).toLowerCase())) {
      errors.push(`Mode must be one of: ${validModes.join(', ')}.`);
    }
    if (String(mode).toLowerCase() === 'sell' && price !== undefined) {
      const numPrice = parseFloat(price);
      if (isNaN(numPrice) || numPrice < 0) {
        errors.push('Selling price must be a non-negative number.');
      }
    }
  }

  if (status !== undefined) {
    const validStatuses = ['Available', 'Reserved', 'Sold'];
    if (!validStatuses.includes(status)) {
      errors.push(`Status must be one of: ${validStatuses.join(', ')}.`);
    }
  }

  if (semester !== undefined && semester !== null && semester !== '') {
    const semNum = parseInt(semester, 10);
    if (isNaN(semNum) || semNum < 1 || semNum > 8) {
      errors.push('Semester must be an integer between 1 and 8.');
    }
  }

  if (condition !== undefined) {
    const validConditions = ['Brand New', 'Like New', 'Excellent', 'Good', 'Fair'];
    const matches = validConditions.some(c => c.toLowerCase() === String(condition).toLowerCase());
    if (!matches) {
      errors.push(`Condition must be one of: ${validConditions.join(', ')}.`);
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({
      error: errors[0],
      errors,
      status: 400
    });
  }

  if (title) req.body.title = title.trim();
  if (author) req.body.author = author.trim();
  if (mode) req.body.mode = String(mode).toLowerCase();
  if (price !== undefined) req.body.price = parseFloat(price) || 0;
  if (semester) req.body.semester = parseInt(semester, 10);

  next();
};

/**
 * Validates user registration payload
 */
exports.validateRegisterInput = (req, res, next) => {
  const { name, email, password, semester, branch, enrollment, whatsapp, whatsappPrivacy, whatsappConsent } = req.body;
  const errors = [];

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    errors.push('Full name is required (minimum 2 characters).');
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email.trim())) {
    errors.push('A valid email address is required.');
  }

  if (!password || typeof password !== 'string' || password.length < 8) {
    errors.push('Password must be at least 8 characters long.');
  }

  if (semester !== undefined && semester !== null && semester !== '') {
    const semNum = parseInt(semester, 10);
    if (isNaN(semNum) || semNum < 1 || semNum > 8) {
      errors.push('Semester must be between 1 and 8.');
    }
  }

  if (whatsapp !== undefined && whatsapp !== null && String(whatsapp).trim() !== '') {
    const waCheck = validateAndFormatWhatsAppNumber(whatsapp);
    if (!waCheck.valid) {
      errors.push(waCheck.error);
    } else {
      req.body.whatsapp = waCheck.formatted;
    }
  } else {
    req.body.whatsapp = '';
  }

  if (whatsappPrivacy !== undefined && whatsappPrivacy !== null && String(whatsappPrivacy).trim() !== '') {
    const validPrivacy = ['share after I approve', 'hide'];
    if (!validPrivacy.includes(whatsappPrivacy)) {
      errors.push("WhatsApp privacy must be 'share after I approve' or 'hide'.");
    }
  } else {
    req.body.whatsappPrivacy = 'share after I approve';
  }

  if (errors.length > 0) {
    return res.status(400).json({
      error: errors[0],
      errors,
      status: 400
    });
  }

  req.body.name = name.trim();
  req.body.email = email.trim().toLowerCase();
  if (enrollment) req.body.enrollment = enrollment.trim();
  if (branch) req.body.branch = branch.trim();
  req.body.whatsappConsent = Boolean(whatsappConsent);

  next();
};

/**
 * Validates user profile update payload
 */
exports.validateProfileUpdate = (req, res, next) => {
  const { name, whatsapp, branch, semester, whatsappPrivacy, whatsappConsent } = req.body;
  const errors = [];

  if (name !== undefined && (typeof name !== 'string' || name.trim().length < 2)) {
    errors.push('Full name must be at least 2 characters long.');
  }

  if (whatsapp !== undefined && whatsapp !== null && String(whatsapp).trim() !== '') {
    const waCheck = validateAndFormatWhatsAppNumber(whatsapp);
    if (!waCheck.valid) {
      errors.push(waCheck.error);
    } else {
      req.body.whatsapp = waCheck.formatted;
    }
  } else if (whatsapp !== undefined) {
    req.body.whatsapp = '';
  }

  if (whatsappPrivacy !== undefined && whatsappPrivacy !== null && String(whatsappPrivacy).trim() !== '') {
    const validPrivacy = ['share after I approve', 'hide'];
    if (!validPrivacy.includes(whatsappPrivacy)) {
      errors.push("WhatsApp privacy must be 'share after I approve' or 'hide'.");
    }
  }

  if (semester !== undefined && semester !== null && semester !== '') {
    const semNum = parseInt(semester, 10);
    if (isNaN(semNum) || semNum < 1 || semNum > 8) {
      errors.push('Semester must be between 1 and 8.');
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({
      error: errors[0],
      errors,
      status: 400
    });
  }

  if (name) req.body.name = name.trim();
  if (branch) req.body.branch = branch.trim();
  if (whatsappConsent !== undefined) req.body.whatsappConsent = Boolean(whatsappConsent);

  next();
};

/**
 * Validates user login payload
 */
exports.validateLoginInput = (req, res, next) => {
  const { email, identifier, password } = req.body;
  const idValue = email || identifier;

  if (!idValue || typeof idValue !== 'string' || idValue.trim().length === 0) {
    return res.status(400).json({
      error: 'Email or Enrollment Number is required.',
      status: 400
    });
  }

  if (!password || typeof password !== 'string' || password.length === 0) {
    return res.status(400).json({
      error: 'Password is required.',
      status: 400
    });
  }

  // Only lowercase e-mails; enrollment numbers must keep their original case
  req.body.email = idValue.includes('@') ? idValue.trim().toLowerCase() : idValue.trim();
  next();
};

/**
 * Validates password reset request
 */
exports.validateForgotPasswordInput = (req, res, next) => {
  const { email } = req.body;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!email || !emailRegex.test(email.trim())) {
    return res.status(400).json({
      error: 'A valid email address is required to reset your password.',
      status: 400
    });
  }

  req.body.email = email.trim().toLowerCase();
  next();
};

/**
 * Validates reset password execution
 */
exports.validateResetPasswordInput = (req, res, next) => {
  const { token, newPassword, password, new_password } = req.body;
  const pass = newPassword || new_password || password;
  const errors = [];

  if (!token || typeof token !== 'string' || token.trim().length < 32) {
    errors.push('A valid, non-expired reset token is required.');
  }

  if (!pass || typeof pass !== 'string' || pass.length < 8) {
    errors.push('Password must be at least 8 characters long.');
  }

  if (req.body.confirmPassword && req.body.confirmPassword !== pass) {
    errors.push('Passwords do not match.');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      error: errors[0],
      errors,
      status: 400
    });
  }

  next();
};

/**
 * Validates chat message text
 */
exports.validateMessageInput = (req, res, next) => {
  const { text, message } = req.body;
  const msgText = text || message;

  if (!msgText || typeof msgText !== 'string' || msgText.trim().length === 0) {
    return res.status(400).json({
      error: 'Message text cannot be empty.',
      status: 400
    });
  }

  if (msgText.trim().length > 5000) {
    return res.status(400).json({
      error: 'Message length cannot exceed 5000 characters.',
      status: 400
    });
  }

  req.body.text = msgText.trim();
  next();
};
