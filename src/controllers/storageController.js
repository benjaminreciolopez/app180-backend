import { createClient } from '@supabase/supabase-js';
import { sql } from '../db.js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_PROJECT_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;
if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
}

export const storageController = {
    /**
     * Listar carpetas disponibles
     */
    async listFolders(req, res) {
        try {
            const empresaId = req.user.empresa_id;
            const folders = await sql`
                SELECT DISTINCT folder 
                FROM storage_180 
                WHERE empresa_id = ${empresaId}
                ORDER BY folder ASC
            `;
            // Return array of strings
            return res.json({
                success: true,
                data: folders.map(f => f.folder)
            });
        } catch (err) {
            console.error('Error listFolders:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    },

    /**
     * Listar archivos de la empresa
     */
    async listFiles(req, res) {
        try {
            const empresaId = req.user.empresa_id;
            const { folder = 'general' } = req.query;

            const files = await sql`
        SELECT * FROM storage_180 
        WHERE empresa_id = ${empresaId} 
          AND folder = ${folder}
        ORDER BY created_at DESC
      `;

            // Simular bar de almacenamiento (ej: 1GB límite)
            const [stats] = await sql`
        SELECT SUM(size_bytes) as used_bytes 
        FROM storage_180 
        WHERE empresa_id = ${empresaId}
      `;

            return res.json({
                success: true,
                data: files,
                stats: {
                    used_bytes: parseInt(stats?.used_bytes || 0),
                    total_limit_bytes: 1024 * 1024 * 1024 // 1GB limit
                }
            });
        } catch (err) {
            console.error('Error listFiles:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    },

    /**
     * Eliminar archivo
     */
    async deleteFile(req, res) {
        try {
            const { id } = req.params;
            const empresaId = req.user.empresa_id;

            const [file] = await sql`
        SELECT * FROM storage_180 WHERE id = ${id} AND empresa_id = ${empresaId}
      `;

            if (!file) return res.status(404).json({ error: 'Archivo no encontrado' });

            // Si tenemos supabase, borrar del bucket
            if (supabase) {
                const { error } = await supabase.storage
                    .from('app180-files')
                    .remove([file.storage_path]);

                if (error) console.error('Error deleting from Supabase Storage:', error);
            }

            await sql`DELETE FROM storage_180 WHERE id = ${id}`;

            res.json({ success: true });
        } catch (err) {
            console.error('Error deleteFile:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    },

    /**
     * Descargar archivo
     */
    async downloadFile(req, res) {
        try {
            const { id } = req.params;
            const empresaId = req.user.empresa_id;

            const [file] = await sql`
                SELECT * FROM storage_180 WHERE id = ${id} AND empresa_id = ${empresaId}
            `;

            if (!file) return res.status(404).json({ error: 'Archivo no encontrado' });

            if (supabase) {
                const { data, error } = await supabase.storage
                    .from('app180-files')
                    .createSignedUrl(file.storage_path, 60); // 60 segundos

                if (error) throw error;
                return res.redirect(data.signedUrl);
            } else {
                return res.status(400).json({ error: 'Supabase no configurado para descarga real' });
            }
        } catch (err) {
            console.error('Error downloadFile:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    },

    /**
     * Subir archivo manual (Explorer)
     */
    async uploadFile(req, res) {
        try {
            const empresaId = req.user.empresa_id;
            const { folder = 'general' } = req.body;
            const file = req.file;

            if (!file) return res.status(400).json({ error: 'No se subió ningún archivo' });

            const record = await saveToStorage({
                empresaId,
                nombre: file.originalname,
                buffer: file.buffer,
                folder,
                mimeType: file.mimetype
            });

            res.json({ success: true, data: record });
        } catch (err) {
            console.error('Error uploadFile:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    }
};

/**
 * Helper para guardar archivo (usado por otros controladores)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.join(__dirname, '../../uploads');

// Asegurar que existe la carpeta uploads
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export async function saveToStorage({ empresaId, nombre, buffer, folder, mimeType, useTimestamp = true, dbFolder = null }) {
    try {
        const finalName = useTimestamp ? `${Date.now()}_${nombre}` : nombre;
        // Estructura: uploads/{empresaId}/{folder}/{filename}
        const relativeFolder = path.join(String(empresaId), folder);
        const absoluteFolder = path.join(UPLOADS_DIR, relativeFolder);

        if (!fs.existsSync(absoluteFolder)) {
            fs.mkdirSync(absoluteFolder, { recursive: true });
        }

        const absolutePath = path.join(absoluteFolder, finalName);
        fs.writeFileSync(absolutePath, buffer);

        console.log(`💾 [saveToDisk] Local Save OK: ${absolutePath}`);

        // Ruta relativa que se guardará en BD y servirá para accesos
        // Usamos barras normales para URLs
        const relativeStoragePath = `uploads/${empresaId}/${folder}/${finalName}`.replace(/\\/g, '/');

        const folderToSave = dbFolder || folder;
        const [record] = await sql`
            INSERT INTO storage_180 (empresa_id, nombre, storage_path, folder, mime_type, size_bytes)
            VALUES (${empresaId}, ${nombre}, ${relativeStoragePath}, ${folderToSave}, ${mimeType}, ${buffer.length})
            RETURNING *
        `;
        return record;

    } catch (err) {
        console.error('Error saveToStorage (Local Disk):', err);
        throw err;
    }
}
