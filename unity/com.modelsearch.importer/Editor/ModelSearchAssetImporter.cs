using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace ModelSearch.Editor
{
    [InitializeOnLoad]
    internal static class ModelSearchAssetImporter
    {
        private const string QueueFolder = ".model-library";
        private static readonly HashSet<string> AllowedExtensions = new(StringComparer.OrdinalIgnoreCase)
        {
            ".fbx", ".obj", ".glb", ".gltf", ".bin", ".mtl",
            ".png", ".jpg", ".jpeg", ".tga", ".tif", ".tiff",
            ".exr", ".hdr", ".webp"
        };

        private static double nextPollTime;
        private static bool isImporting;

        static ModelSearchAssetImporter()
        {
            EditorApplication.update += Poll;
            nextPollTime = EditorApplication.timeSinceStartup + 1.0;
        }

        private static string ProjectRoot =>
            Path.GetDirectoryName(Application.dataPath)
            ?? throw new InvalidOperationException("Unity project root is unavailable.");

        private static string Inbox =>
            Path.Combine(ProjectRoot, QueueFolder, "inbox");

        private static string Outbox =>
            Path.Combine(ProjectRoot, QueueFolder, "outbox");

        private static string Archive =>
            Path.Combine(ProjectRoot, QueueFolder, "archive");

        private static void Poll()
        {
            if (isImporting || EditorApplication.timeSinceStartup < nextPollTime)
            {
                return;
            }

            nextPollTime = EditorApplication.timeSinceStartup + 1.5;
            if (!Directory.Exists(Inbox))
            {
                return;
            }

            string[] requests;
            try
            {
                requests = Directory.GetFiles(Inbox, "*.json", SearchOption.TopDirectoryOnly);
            }
            catch (Exception)
            {
                return;
            }

            if (requests.Length == 0)
            {
                return;
            }

            isImporting = true;
            try
            {
                foreach (string requestPath in requests)
                {
                    ProcessRequest(requestPath);
                }
            }
            finally
            {
                isImporting = false;
            }
        }

        internal static ImportResult ProcessRequest(string requestPath)
        {
            string processingPath = requestPath + ".processing";
            ImportRequest request = null;
            try
            {
                File.Move(requestPath, processingPath);
                request = JsonUtility.FromJson<ImportRequest>(
                    File.ReadAllText(processingPath)
                );
                if (request == null || string.IsNullOrWhiteSpace(request.requestId))
                {
                    throw new InvalidDataException("Import request is missing an id.");
                }

                string sourceDirectory = Path.GetFullPath(request.sourceDirectory);
                string preferredModel = Path.GetFullPath(request.preferredModel);
                if (!IsInside(sourceDirectory, preferredModel))
                {
                    throw new InvalidDataException(
                        "Preferred model is outside the prepared asset directory."
                    );
                }
                if (!File.Exists(preferredModel))
                {
                    throw new FileNotFoundException(
                        "Prepared model file was not found.",
                        preferredModel
                    );
                }

                string targetDirectory = NormalizeTargetDirectory(request);
                string absoluteTarget = Path.Combine(
                    ProjectRoot,
                    targetDirectory.Replace('/', Path.DirectorySeparatorChar)
                );
                Directory.CreateDirectory(absoluteTarget);
                CopyAllowedFiles(sourceDirectory, absoluteTarget, preferredModel);
                if (!string.IsNullOrWhiteSpace(request.licensePath)
                    && File.Exists(request.licensePath))
                {
                    File.Copy(
                        request.licensePath,
                        Path.Combine(absoluteTarget, "LICENSE.json"),
                        true
                    );
                }

                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
                string relativeModel = Path.GetFileName(preferredModel);
                string importedPath = $"{targetDirectory}/{relativeModel}";
                AssetDatabase.ImportAsset(
                    importedPath,
                    ImportAssetOptions.ForceSynchronousImport
                );
                ConfigureModelImporter(importedPath, request.scale);

                ImportResult result = new()
                {
                    requestId = request.requestId,
                    assetId = request.assetId,
                    status = "completed",
                    importedPath = importedPath,
                    message = "Asset imported successfully.",
                    importedAt = DateTime.UtcNow.ToString("O")
                };
                WriteResult(result);
                MoveToArchive(processingPath, request.requestId);
                return result;
            }
            catch (Exception error)
            {
                string requestId = request?.requestId;
                if (string.IsNullOrWhiteSpace(requestId))
                {
                    requestId = Path.GetFileNameWithoutExtension(requestPath);
                }
                WriteResult(new ImportResult
                {
                    requestId = requestId,
                    assetId = request?.assetId ?? "",
                    status = "failed",
                    importedPath = "",
                    message = error.ToString(),
                    importedAt = DateTime.UtcNow.ToString("O")
                });
                MoveToArchive(processingPath, requestId);
                Debug.LogError($"[ModelSearch] Unity import failed: {error}");
                return new ImportResult
                {
                    requestId = requestId,
                    assetId = request?.assetId ?? "",
                    status = "failed",
                    importedPath = "",
                    message = error.ToString(),
                    importedAt = DateTime.UtcNow.ToString("O")
                };
            }
        }

        private static string NormalizeTargetDirectory(ImportRequest request)
        {
            string source = SanitizeSegment(request.sourceId);
            string asset = SanitizeSegment(request.assetId);
            string requested = string.IsNullOrWhiteSpace(request.targetDirectory)
                ? $"Assets/ModelLibrary/{source}/{asset}"
                : request.targetDirectory.Replace('\\', '/').TrimEnd('/');
            if (!requested.StartsWith("Assets/", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException(
                    "Unity target directory must be inside Assets/."
                );
            }
            return requested;
        }

        private static string SanitizeSegment(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return "asset";
            }
            foreach (char invalid in Path.GetInvalidFileNameChars())
            {
                value = value.Replace(invalid, '-');
            }
            return value.Replace('/', '-').Replace('\\', '-');
        }

        private static void CopyAllowedFiles(
            string sourceDirectory,
            string targetDirectory,
            string preferredModel
        )
        {
            foreach (string file in Directory.GetFiles(
                         sourceDirectory,
                         "*",
                         SearchOption.AllDirectories
                     ))
            {
                if (!AllowedExtensions.Contains(Path.GetExtension(file)))
                {
                    continue;
                }
                string relative = Path.GetRelativePath(sourceDirectory, file);
                string destination = Path.Combine(targetDirectory, relative);
                Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                File.Copy(file, destination, true);
            }

            string preferredDestination = Path.Combine(
                targetDirectory,
                Path.GetRelativePath(sourceDirectory, preferredModel)
            );
            if (!File.Exists(preferredDestination))
            {
                File.Copy(preferredModel, preferredDestination, true);
            }
        }

        private static void ConfigureModelImporter(string assetPath, float scale)
        {
            AssetImporter importer = AssetImporter.GetAtPath(assetPath);
            if (importer is not ModelImporter modelImporter)
            {
                return;
            }
            modelImporter.globalScale = scale > 0 ? scale : 1f;
            modelImporter.importAnimation = true;
            modelImporter.importCameras = false;
            modelImporter.importLights = false;
            modelImporter.addCollider = false;
            modelImporter.SaveAndReimport();
        }

        private static bool IsInside(string root, string candidate)
        {
            string normalizedRoot = Path.GetFullPath(root)
                .TrimEnd(Path.DirectorySeparatorChar)
                + Path.DirectorySeparatorChar;
            return Path.GetFullPath(candidate).StartsWith(
                normalizedRoot,
                StringComparison.OrdinalIgnoreCase
            );
        }

        private static void WriteResult(ImportResult result)
        {
            Directory.CreateDirectory(Outbox);
            File.WriteAllText(
                Path.Combine(Outbox, result.requestId + ".result.json"),
                JsonUtility.ToJson(result, true)
            );
        }

        private static void MoveToArchive(string processingPath, string requestId)
        {
            if (!File.Exists(processingPath))
            {
                return;
            }
            Directory.CreateDirectory(Archive);
            string target = Path.Combine(
                Archive,
                requestId + ".request.json"
            );
            if (File.Exists(target))
            {
                File.Delete(target);
            }
            File.Move(processingPath, target);
        }

        [Serializable]
        private sealed class ImportRequest
        {
            public string requestId;
            public string assetId;
            public string sourceId;
            public string sourceDirectory;
            public string preferredModel;
            public string targetDirectory;
            public string sourceUrl;
            public string licensePath;
            public float scale = 1f;
        }

        [Serializable]
        internal sealed class ImportResult
        {
            public string requestId;
            public string assetId;
            public string status;
            public string importedPath;
            public string message;
            public string importedAt;
        }
    }
}
