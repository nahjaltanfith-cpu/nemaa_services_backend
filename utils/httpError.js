// Errors thrown by services; controllers turn them into the standard JSON envelope.
export class HttpError extends Error {
    constructor(status, message, code) {
        super(message);
        this.status = status;
        this.code = code;
    }
}
