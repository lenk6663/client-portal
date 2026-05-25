export const S3Client = jest.fn().mockImplementation(() => ({
  send: jest.fn(),
}));
export const PutObjectCommand = jest.fn();
export const GetObjectCommand = jest.fn();
