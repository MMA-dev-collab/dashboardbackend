/**
 * Unit tests for input validators.
 */
const { loginSchema, registerSchema } = require('../../src/modules/auth/auth.validator');
const { createProjectSchema } = require('../../src/modules/projects/project.validator');

describe('Auth Validators', () => {
  describe('loginSchema', () => {
    it('accepts valid email and password', () => {
      const { error } = loginSchema.validate({ email: 'test@example.com', password: 'password123' });
      expect(error).toBeUndefined();
    });

    it('rejects missing email', () => {
      const { error } = loginSchema.validate({ password: 'password123' });
      expect(error).toBeDefined();
      expect(error.details[0].path).toContain('email');
    });

    it('rejects invalid email format', () => {
      const { error } = loginSchema.validate({ email: 'not-an-email', password: 'password123' });
      expect(error).toBeDefined();
    });

    it('rejects short password', () => {
      const { error } = loginSchema.validate({ email: 'test@example.com', password: '12345' });
      expect(error).toBeDefined();
    });

    it('trims and lowercases email', () => {
      const { value } = loginSchema.validate({ email: '  Test@Example.COM  ', password: 'password123' });
      expect(value.email).toBe('test@example.com');
    });
  });

  describe('registerSchema', () => {
    const validData = {
      email: 'new@example.com',
      password: 'StrongPass1',
      firstName: 'John',
      lastName: 'Doe',
    };

    it('accepts valid registration data', () => {
      const { error } = registerSchema.validate(validData);
      expect(error).toBeUndefined();
    });

    it('rejects weak password', () => {
      const { error } = registerSchema.validate({ ...validData, password: 'weak' });
      expect(error).toBeDefined();
    });

    it('rejects missing first name', () => {
      const { error } = registerSchema.validate({ ...validData, firstName: undefined });
      expect(error).toBeDefined();
    });
  });
});

describe('Project Validators', () => {
  describe('createProjectSchema', () => {
    const validProject = {
      name: 'Test Project',
      clientName: 'Test Client',
      totalValue: 50000,
    };

    it('accepts valid project data', () => {
      const { error } = createProjectSchema.validate(validProject);
      expect(error).toBeUndefined();
    });

    it('rejects negative total value', () => {
      const { error } = createProjectSchema.validate({ ...validProject, totalValue: -100 });
      expect(error).toBeDefined();
    });

    it('rejects company percentage over 100', () => {
      const { error } = createProjectSchema.validate({ ...validProject, companyPercentage: 150 });
      expect(error).toBeDefined();
    });

    it('defaults company percentage to 30', () => {
      const { value } = createProjectSchema.validate(validProject);
      expect(value.companyPercentage).toBe(30);
    });

    it('validates partner structure', () => {
      const { error } = createProjectSchema.validate({
        ...validProject,
        partners: [{ userId: 'not-a-uuid', percentage: 100 }],
      });
      expect(error).toBeDefined();
    });
  });
});
