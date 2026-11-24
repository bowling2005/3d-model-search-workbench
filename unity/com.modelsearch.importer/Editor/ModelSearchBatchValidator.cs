using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace ModelSearch.Editor
{
    internal static class ModelSearchBatchValidator
    {
        private const string QueueFolder = ".model-library";
        private const string ValidationScenePath =
            "Assets/ModelLibrary/Validation/ModelSearchImportValidation.unity";

        public static void Run()
        {
            try
            {
                string projectRoot = Path.GetDirectoryName(Application.dataPath)
                    ?? throw new InvalidOperationException("Project root unavailable.");
                string inbox = Path.Combine(projectRoot, QueueFolder, "inbox");
                string[] requests = Directory.Exists(inbox)
                    ? Directory.GetFiles(inbox, "*.json")
                    : Array.Empty<string>();
                if (requests.Length == 0)
                {
                    throw new InvalidDataException(
                        "No Model Search import requests were found in .model-library/inbox."
                    );
                }

                ModelSearchAssetImporter.ImportResult lastResult = null;
                foreach (string request in requests.OrderBy(path => path))
                {
                    lastResult = ModelSearchAssetImporter.ProcessRequest(request);
                }
                if (lastResult == null || lastResult.status != "completed")
                {
                    throw new InvalidOperationException(
                        lastResult?.message ?? "Unity import did not complete."
                    );
                }

                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
                GameObject modelAsset = AssetDatabase.LoadAssetAtPath<GameObject>(
                    lastResult.importedPath
                );
                if (modelAsset == null)
                {
                    throw new InvalidDataException(
                        $"Imported model could not be loaded: {lastResult.importedPath}"
                    );
                }

                Scene scene = EditorSceneManager.NewScene(
                    NewSceneSetup.EmptyScene,
                    NewSceneMode.Single
                );
                GameObject model = UnityEngine.Object.Instantiate(modelAsset);
                model.name = "ModelSearch Imported Asset";

                GameObject cameraObject = new("Main Camera");
                Camera camera = cameraObject.AddComponent<Camera>();
                cameraObject.tag = "MainCamera";
                cameraObject.transform.position = new Vector3(2.8f, 2.1f, 3.6f);
                cameraObject.transform.LookAt(Vector3.zero);

                GameObject lightObject = new("Directional Light");
                Light light = lightObject.AddComponent<Light>();
                light.type = LightType.Directional;
                light.intensity = 1.2f;
                lightObject.transform.rotation = Quaternion.Euler(48f, -32f, 0f);

                string sceneDirectory = Path.GetDirectoryName(
                    ValidationScenePath.Replace('/', Path.DirectorySeparatorChar)
                );
                if (!string.IsNullOrWhiteSpace(sceneDirectory))
                {
                    Directory.CreateDirectory(
                        Path.Combine(projectRoot, sceneDirectory)
                    );
                }
                EditorSceneManager.SaveScene(scene, ValidationScenePath);
                AssetDatabase.SaveAssets();

                string outbox = Path.Combine(projectRoot, QueueFolder, "outbox");
                Directory.CreateDirectory(outbox);
                File.WriteAllText(
                    Path.Combine(outbox, "island-validation.json"),
                    JsonUtility.ToJson(
                        new ValidationResult
                        {
                            status = "completed",
                            assetId = lastResult.assetId,
                            importedPath = lastResult.importedPath,
                            scenePath = ValidationScenePath,
                            message = "Import and validation scene creation succeeded.",
                            completedAt = DateTime.UtcNow.ToString("O")
                        },
                        true
                    )
                );
                Debug.Log(
                    $"[ModelSearch] Validation scene created: {ValidationScenePath}"
                );
                EditorApplication.Exit(0);
            }
            catch (Exception error)
            {
                Debug.LogError($"[ModelSearch] Batch validation failed: {error}");
                EditorApplication.Exit(1);
            }
        }

        [Serializable]
        private sealed class ValidationResult
        {
            public string status;
            public string assetId;
            public string importedPath;
            public string scenePath;
            public string message;
            public string completedAt;
        }
    }
}
