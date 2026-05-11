import multer from 'multer';

const storage = multer.memoryStorage();

const ALLOWED_MIME = new Set([
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/svg+xml',
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/x-pkcs12',
    'application/pkcs12',
    'application/octet-stream',
    'application/zip',
    'text/plain',
    'application/json',
]);

const ALLOWED_EXT = /\.(pdf|jpe?g|png|webp|svg|csv|xlsx?|p12|pfx|zip|txt|json|xml)$/i;

const fileFilter = (req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase();
    const name = file.originalname || '';
    if (ALLOWED_MIME.has(mime) || ALLOWED_EXT.test(name)) {
        return cb(null, true);
    }
    return cb(new Error(`Tipo de archivo no permitido: ${mime || name}`));
};

const upload = multer({
    storage,
    limits: {
        fileSize: 10 * 1024 * 1024,
        files: 20,
    },
    fileFilter,
});

export default upload;
