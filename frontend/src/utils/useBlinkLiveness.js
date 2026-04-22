import { useEffect, useRef, useState } from 'react';
import { FaceMesh } from '@mediapipe/face_mesh';

const LEFT_EYE = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE = [362, 385, 387, 263, 373, 380];

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const eyeAspectRatio = (landmarks, eye) => {
  const p1 = landmarks[eye[0]];
  const p2 = landmarks[eye[1]];
  const p3 = landmarks[eye[2]];
  const p4 = landmarks[eye[3]];
  const p5 = landmarks[eye[4]];
  const p6 = landmarks[eye[5]];
  const horizontal = distance(p1, p4);
  if (!horizontal) return 0;
  return (distance(p2, p6) + distance(p3, p5)) / (2 * horizontal);
};

const isFacingCamera = (landmarks) => {
  const nose = landmarks[1];
  const leftEyeOuter = landmarks[33];
  const rightEyeOuter = landmarks[263];
  const faceWidth = distance(leftEyeOuter, rightEyeOuter);

  const centered = Math.abs(nose.x - 0.5) < 0.2 && Math.abs(nose.y - 0.5) < 0.25;
  const closeEnough = faceWidth > 0.06;

  return centered && closeEnough;
};

function useBlinkLiveness(webcamRef, isActive) {
  const faceMeshRef = useRef(null);
  const rafRef = useRef(null);
  const runningRef = useRef(false);
  const baselineRef = useRef(0);
  const eyeClosedRef = useRef(false);
  const lastBlinkMsRef = useRef(0);
  const faceMissingFramesRef = useRef(0);
  const livenessPassedRef = useRef(false);

  const [blinkCount, setBlinkCount] = useState(0);
  const [isFaceDetected, setIsFaceDetected] = useState(false);
  const [isLookingAtCamera, setIsLookingAtCamera] = useState(false);
  const [livenessPassed, setLivenessPassed] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Open camera and position your face in frame.');

  const resetState = () => {
    baselineRef.current = 0;
    eyeClosedRef.current = false;
    lastBlinkMsRef.current = 0;
    faceMissingFramesRef.current = 0;
    setBlinkCount(0);
    setIsFaceDetected(false);
    setIsLookingAtCamera(false);
    livenessPassedRef.current = false;
    setLivenessPassed(false);
    setStatusMessage('Open camera and position your face in frame.');
  };

  useEffect(() => {
    if (!isActive) {
      runningRef.current = false;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      resetState();
      return;
    }

    resetState();
    let isMounted = true;

    const startDetection = async () => {
      try {
        const faceMesh = new FaceMesh({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
        });

        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        faceMesh.onResults((results) => {
          if (!isMounted) return;

          const landmarks = results.multiFaceLandmarks?.[0];
          if (!landmarks) {
            faceMissingFramesRef.current += 1;
            setIsFaceDetected(false);
            setIsLookingAtCamera(false);

            if (livenessPassedRef.current && faceMissingFramesRef.current >= 8) {
              resetState();
              setStatusMessage('Face lost from camera. Liveness check reset.');
            } else if (!livenessPassedRef.current) {
              setStatusMessage('Face not detected. Move into frame and keep good lighting.');
            }

            return;
          }

          faceMissingFramesRef.current = 0;

          setIsFaceDetected(true);
          const looking = isFacingCamera(landmarks);
          setIsLookingAtCamera(looking);

          const leftEar = eyeAspectRatio(landmarks, LEFT_EYE);
          const rightEar = eyeAspectRatio(landmarks, RIGHT_EYE);
          const avgEar = (leftEar + rightEar) / 2;

          if (!baselineRef.current) {
            baselineRef.current = avgEar;
          }

          if (avgEar > baselineRef.current * 0.75) {
            baselineRef.current = baselineRef.current * 0.9 + avgEar * 0.1;
          }

          const closedThreshold = baselineRef.current * 0.7;
          const eyesClosed = avgEar < closedThreshold;

          if (looking && eyesClosed && !eyeClosedRef.current) {
            eyeClosedRef.current = true;
          }

          if (looking && !eyesClosed && eyeClosedRef.current) {
            eyeClosedRef.current = false;
            const now = Date.now();
            if (now - lastBlinkMsRef.current > 400) {
              lastBlinkMsRef.current = now;
              setBlinkCount((prev) => {
                const next = prev + 1;
                if (next >= 1) {
                  livenessPassedRef.current = true;
                  setLivenessPassed(true);
                  setStatusMessage('Blink detected. You can now capture your photo.');
                }
                return next;
              });
            }
          }

          if (!livenessPassedRef.current) {
            if (!looking) {
              setStatusMessage('Look straight at the camera to continue liveness check.');
            } else {
              setStatusMessage('Blink once naturally while looking at the camera.');
            }
          }
        });

        await faceMesh.initialize();
        faceMeshRef.current = faceMesh;
        runningRef.current = true;

        const loop = async () => {
          if (!runningRef.current || !isMounted) return;

          const video = webcamRef.current?.video;
          if (video && video.readyState >= 2) {
            await faceMesh.send({ image: video });
          }

          rafRef.current = requestAnimationFrame(loop);
        };

        loop();
      } catch (error) {
        console.error('Blink liveness initialization failed:', error);
        if (isMounted) {
          setStatusMessage('Unable to start liveness check. Please refresh and try again.');
        }
      }
    };

    startDetection();

    return () => {
      isMounted = false;
      runningRef.current = false;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      if (faceMeshRef.current) {
        faceMeshRef.current.close();
      }
    };
  }, [isActive, webcamRef]);

  return {
    blinkCount,
    isFaceDetected,
    isLookingAtCamera,
    livenessPassed,
    statusMessage,
  };
}

export default useBlinkLiveness;
