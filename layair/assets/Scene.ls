{
  "name": "Scene2D",
  "left": 0,
  "right": 0,
  "top": 0,
  "bottom": 0,
  "_$ver": 1,
  "_$id": "lx8mwule",
  "_$type": "Scene",
  "_$comp": [
    {
      "_$type": "7bad1742-6eed-4d8d-81c0-501dc5bf03d6"
    }
  ],
  "_$child": [
    {
      "_$id": "3f4cd1704d",
      "_$type": "Scene3D",
      "name": "Scene3D",
      "ambientMode": 0,
      "ambientColor": {
        "_$type": "Color",
        "r": 0.424308,
        "g": 0.4578516,
        "b": 0.5294118
      },
      "fogStart": 0,
      "fogRange": 300,
      "fogColor": {
        "_$type": "Color",
        "r": 0.5,
        "g": 0.5,
        "b": 0.5
      },
      "lightmaps": [],
      "_$child": [
        {
          "_$id": "34745a338f",
          "_$type": "Camera",
          "name": "Main Camera",
          "transform": {
            "localPosition": {
              "_$type": "Vector3",
              "x": 0,
              "y": 4,
              "z": 6
            },
            "localRotationEuler": {
              "_$type": "Vector3",
              "x": -35,
              "y": 0,
              "z": 0
            }
          },
          "clearFlag": 1,
          "clearColor": {
            "_$type": "Color",
            "r": 0.03,
            "g": 0.09,
            "b": 0.07,
            "a": 1
          },
          "orthographicVerticalSize": 10,
          "fieldOfView": 45,
          "nearPlane": 0.1,
          "farPlane": 5000,
          "normalizedViewport": {
            "_$type": "Viewport",
            "width": 1,
            "height": 1
          }
        },
        {
          "_$id": "595dbfcdd0",
          "_$type": "Sprite3D",
          "name": "Direction Light",
          "transform": {
            "localPosition": {
              "_$type": "Vector3",
              "x": 5,
              "y": 8,
              "z": 5
            },
            "localRotationEuler": {
              "_$type": "Vector3",
              "x": -50,
              "y": 30,
              "z": 0
            }
          },
          "_$comp": [
            {
              "_$type": "DirectionLightCom",
              "color": {
                "_$type": "Color",
                "r": 0.6,
                "g": 0.6,
                "b": 0.6
              },
              "lightmapBakedType": 1,
              "shadowMode": 0,
              "shadowStrength": 1,
              "shadowDistance": 50,
              "shadowDepthBias": 1,
              "shadowNormalBias": 1,
              "shadowNearPlane": 0.1,
              "shadowCascadesMode": 0
            }
          ]
        }
      ]
    }
  ]
}