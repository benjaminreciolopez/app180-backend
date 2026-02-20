import multer from 'multer';

// Configuración de almacenamiento en memoria para procesar o subir a S3/GCS después
const storage = multer.memoryStorage();

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // Límite de 10MB
    }
});

export default upload;
