export const chromium = {
  launch: jest.fn().mockResolvedValue({
    newContext: jest.fn().mockResolvedValue({
      newPage: jest.fn().mockResolvedValue({
        goto: jest.fn().mockResolvedValue(null),
        content: jest.fn().mockResolvedValue('<html></html>'),
        close: jest.fn().mockResolvedValue(null),
      }),
      close: jest.fn().mockResolvedValue(null),
    }),
    close: jest.fn().mockResolvedValue(null),
  }),
};
