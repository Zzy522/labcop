declare module 'nodemailer' {
  interface Transporter {
    sendMail(options: unknown): Promise<unknown>;
  }

  function createTransport(options: unknown): Transporter;

  const nodemailer: {
    createTransport: typeof createTransport;
  };

  export default nodemailer;
}
