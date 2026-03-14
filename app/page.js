"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { LANGUAGES, languageName } from "../lib/languages";

function isSpeechRecognitionSupported() {
  return (
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)
  );
}

function isSpeechSynthesisSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function createRecognition(sourceLang) {
  if (!isSpeechRecognitionSupported()) return null;
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SpeechRecognition();
  recognition.lang = sourceLang || "en";
  recognition.interimResults = true;
  recognition.continuous = true;
  return recognition;
}

function useVoices(canUseSpeechSynthesis) {
  const [voices, setVoices] = useState([]);

  const load = () => {
    if (!canUseSpeechSynthesis) return;
    const available = window.speechSynthesis.getVoices();
    setVoices(available || []);
  };

  useEffect(() => {
    if (!canUseSpeechSynthesis) return undefined;

    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, [canUseSpeechSynthesis]);

  return { voices, refreshVoices: load };
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const RTC_CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};


export default function HomePage() {
  const [sourceLang, setSourceLang] = useState("en");
  const [targetLang, setTargetLang] = useState("es");
  const [roomId, setRoomId] = useState("studio");
  const [joinedRoom, setJoinedRoom] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [lastUtterance, setLastUtterance] = useState("");
  const [translateMode, setTranslateMode] = useState("utterance");
  const [utteranceLog, setUtteranceLog] = useState([]);
  const [translation, setTranslation] = useState("");
  const [status, setStatus] = useState("Idle");
  const [isListening, setIsListening] = useState(false);
  const [autoRestartMic, setAutoRestartMic] = useState(true);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [voiceUri, setVoiceUri] = useState("");
  const [messages, setMessages] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [latencyMs, setLatencyMs] = useState(null);
  const [provider, setProvider] = useState("stub");
  const [muted, setMuted] = useState(false);
  const [connectionState, setConnectionState] = useState("offline");
  const [callStatus, setCallStatus] = useState("");
  const [remoteStreams, setRemoteStreams] = useState([]);
  const [roomLink, setRoomLink] = useState("");
  const [isLocalhost, setIsLocalhost] = useState(false);
  const [transport, setTransport] = useState("none");
  const [typedInput, setTypedInput] = useState("");
  const [autoDetect, setAutoDetect] = useState(false);
  const [showAudioHelp, setShowAudioHelp] = useState(false);
  const [capabilities, setCapabilities] = useState({
    speechRecognition: false,
    speechSynthesis: false
  });

  const recognitionRef = useRef(null);
  const supabaseRef = useRef(null);
  const channelRef = useRef(null);
  const peersRef = useRef(new Map());
  const peerFlagsRef = useRef(new Map());
  const localStreamRef = useRef(null);
  const micWantedRef = useRef(false);
  const autoRestartRef = useRef(true);
  const userId = useRef(
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `user-${Math.random().toString(36).slice(2, 8)}`
  );

  useEffect(() => {
    setCapabilities({
      speechRecognition: isSpeechRecognitionSupported(),
      speechSynthesis: isSpeechSynthesisSupported()
    });
  }, []);

  useEffect(() => {
    autoRestartRef.current = autoRestartMic;
  }, [autoRestartMic]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const host = window.location.hostname;
    setIsLocalhost(host === "localhost" || host === "127.0.0.1" || host === "::1");
  }, []);

  const { voices, refreshVoices } = useVoices(capabilities.speechSynthesis);

  const availableVoices = useMemo(() => voices || [], [voices]);

  const selectedVoice = useMemo(() => {
    if (!voiceUri) return null;
    return availableVoices.find((voice) => voice.voiceURI === voiceUri) || null;
  }, [availableVoices, voiceUri]);

  const activeSpeechText = useMemo(
    () => (translateMode === "full" ? finalTranscript : lastUtterance),
    [translateMode, finalTranscript, lastUtterance]
  );

  const canTranslate = useMemo(
    () => Boolean(targetLang && (activeSpeechText.trim() || typedInput.trim())),
    [targetLang, activeSpeechText, typedInput]
  );

  const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

  const getSupabase = () => {
    if (!supabaseConfigured) return null;
    if (!supabaseRef.current) {
      supabaseRef.current = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return supabaseRef.current;
  };

  const upsertRemoteStream = (peerId, stream) => {
    setRemoteStreams((prev) => {
      const existing = prev.find((entry) => entry.userId === peerId);
      if (existing && existing.stream === stream) return prev;
      if (existing) {
        return prev.map((entry) =>
          entry.userId === peerId ? { ...entry, stream } : entry
        );
      }
      return [{ userId: peerId, stream }, ...prev];
    });
  };

  const removeRemoteStream = (peerId) => {
    setRemoteStreams((prev) => prev.filter((entry) => entry.userId !== peerId));
  };

  const startLocalAudio = async () => {
    if (localStreamRef.current) return localStreamRef.current;
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      setCallStatus("Microphone access is not available.");
      return null;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      peersRef.current.forEach((pc) => {
        const hasAudio = pc
          .getSenders()
          .some((sender) => sender.track && sender.track.kind === "audio");
        if (!hasAudio) {
          stream.getTracks().forEach((track) => pc.addTrack(track, stream));
        }
      });
      setCallStatus("");
      return stream;
    } catch (error) {
      setCallStatus("Microphone permission denied.");
      return null;
    }
  };

  const stopLocalAudio = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
  };

  const sendSignal = async (to, payload) => {
    if (!channelRef.current) return;
    await channelRef.current.send({
      type: "broadcast",
      event: "signal",
      payload: {
        ...payload,
        from: userId.current,
        to
      }
    });
  };

  const cleanupPeer = (peerId) => {
    const pc = peersRef.current.get(peerId);
    if (pc) {
      pc.close();
    }
    peersRef.current.delete(peerId);
    peerFlagsRef.current.delete(peerId);
    removeRemoteStream(peerId);
  };

  const createPeerConnection = (peerId) => {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    peersRef.current.set(peerId, pc);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal(peerId, { type: "ice", candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) {
        upsertRemoteStream(peerId, stream);
      }
    };

    pc.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
        cleanupPeer(peerId);
      }
    };

    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    }

    return pc;
  };

  const getPeerConnection = (peerId) =>
    peersRef.current.get(peerId) || createPeerConnection(peerId);

  const handleSignal = async (payload) => {
    if (!payload || payload.to !== userId.current) return;
    const peerId = payload.from;
    if (!peerId) return;
    const pc = getPeerConnection(peerId);

    if (payload.type === "offer") {
      await startLocalAudio();
      await pc.setRemoteDescription(payload.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sendSignal(peerId, { type: "answer", sdp: pc.localDescription });
      return;
    }

    if (payload.type === "answer") {
      await pc.setRemoteDescription(payload.sdp);
      return;
    }

    if (payload.type === "ice" && payload.candidate) {
      try {
        await pc.addIceCandidate(payload.candidate);
      } catch (error) {
        setCallStatus("Failed to add ICE candidate.");
      }
    }
  };

  const syncPeers = async (participantList) => {
    const ids = participantList
      .map((participant) => participant.userId)
      .filter((id) => id && id !== userId.current);
    const idSet = new Set(ids);

    for (const peerId of peersRef.current.keys()) {
      if (!idSet.has(peerId)) {
        cleanupPeer(peerId);
      }
    }

    for (const peerId of ids) {
      const shouldInitiate = userId.current < peerId;
      const flags = peerFlagsRef.current.get(peerId) || {};
      const pc = getPeerConnection(peerId);

      if (shouldInitiate && !flags.offered) {
        flags.offered = true;
        peerFlagsRef.current.set(peerId, flags);
        await startLocalAudio();
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await sendSignal(peerId, { type: "offer", sdp: pc.localDescription });
      }
    }
  };

  const cleanupRoom = async () => {
    if (channelRef.current) {
      await channelRef.current.untrack();
      await channelRef.current.unsubscribe();
      channelRef.current = null;
    }
    peersRef.current.forEach((pc) => pc.close());
    peersRef.current.clear();
    peerFlagsRef.current.clear();
    stopLocalAudio();
    setRemoteStreams([]);
    setParticipants([]);
    setConnectionState("offline");
    setTransport("none");
  };

  const handleCopyLink = async () => {
    if (!roomLink) return;
    try {
      await navigator.clipboard.writeText(roomLink);
      setCallStatus("Invite link copied.");
      setTimeout(() => setCallStatus(""), 2000);
    } catch (error) {
      setCallStatus("Unable to copy invite link.");
    }
  };


  useEffect(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (error) {
        // ignore stop errors when switching languages
      }
    }
    micWantedRef.current = false;
    setIsListening(false);
    setStatus("Idle");
    recognitionRef.current = createRecognition(sourceLang);

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, [sourceLang]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleVisibility = () => {
      if (document.hidden && isListening) {
        micWantedRef.current = false;
        if (recognitionRef.current) recognitionRef.current.stop();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [isListening]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get("room");
    if (roomParam) {
      setRoomId(roomParam);
      setJoinedRoom(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!roomId.trim()) {
      setRoomLink("");
      return;
    }
    setRoomLink(`${window.location.origin}?room=${encodeURIComponent(roomId.trim())}`);
  }, [roomId]);

  useEffect(() => {
    if (!joinedRoom || !roomId) return;
    if (!supabaseConfigured) {
      setCallStatus("Supabase is not configured.");
      setConnectionState("offline");
      setTransport("supabase");
      return;
    }

    const supabase = getSupabase();
    if (!supabase) return;

    setTransport("supabase");
    setConnectionState("connecting");

    const channel = supabase.channel(`room:${roomId}`, {
      config: {
        broadcast: { self: false },
        presence: { key: userId.current }
      }
    });

    channelRef.current = channel;

    channel.on("broadcast", { event: "signal" }, ({ payload }) => {
      handleSignal(payload);
    });

    channel.on("broadcast", { event: "utterance" }, ({ payload }) => {
      handleIncomingUtterance(payload);
    });

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      const list = Object.values(state)
        .flat()
        .map((entry) => ({
          userId: entry.userId,
          targetLang: entry.targetLang
        }));
      const filtered = list.filter((entry) => entry.userId !== userId.current);
      setParticipants(filtered);
      syncPeers(filtered);
    });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        setConnectionState("online");
        setCallStatus("");
        await channel.track({ userId: userId.current, targetLang });
        await startLocalAudio();
      }
      if (status === "CHANNEL_ERROR") {
        setConnectionState("offline");
        setCallStatus("Realtime connection error.");
      }
    });

    return () => {
      cleanupRoom();
    };
  }, [joinedRoom, roomId, targetLang]);


  useEffect(() => {
    if (!joinedRoom || !channelRef.current) return;
    channelRef.current.track({ userId: userId.current, targetLang });
  }, [joinedRoom, targetLang]);

  useEffect(() => {
    if (!recognitionRef.current) return;

    const recognition = recognitionRef.current;

    recognition.onstart = () => {
      setStatus("Listening...");
      setIsListening(true);
    };
    recognition.onend = () => {
      if (autoRestartRef.current && micWantedRef.current) {
        if (typeof document !== "undefined" && document.hidden) {
          setStatus("Paused (tab not active)");
          setIsListening(false);
          return;
        }
        setStatus("Listening...");
        setTimeout(() => {
          try {
            recognition.start();
          } catch (error) {
            setStatus("Mic error");
            setIsListening(false);
          }
        }, 300);
        return;
      }
      setStatus("Idle");
      setIsListening(false);
    };
    recognition.onerror = () => {
      setStatus("Mic error");
      setIsListening(false);
    };
    recognition.onresult = (event) => {
      let interim = "";
      let finalText = "";

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      if (interim) {
        setTranscript(interim);
      }

      if (finalText) {
        const cleaned = finalText.trim();
        setFinalTranscript((prev) => `${prev} ${cleaned}`.trim());
        setLastUtterance(cleaned);
        setTranscript("");
      }
    };
  }, []);

  useEffect(() => {
    if (translateMode === "utterance") {
      if (!lastUtterance.trim()) return;
      translateText(lastUtterance, { logUtterance: true });
      return;
    }

    if (!finalTranscript.trim()) return;
    translateText(finalTranscript);
  }, [translateMode, lastUtterance, finalTranscript]);

  const translateText = async (text, options = {}) => {
    const { logUtterance = false } = options;
    const start = performance.now();
    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          sourceLang: autoDetect ? "" : sourceLang,
          targetLang
        })
      });
      const data = await response.json();
      if (response.ok) {
        setTranslation(data.translation);
        if (data.provider) setProvider(data.provider);
        setLatencyMs(Math.round(performance.now() - start));

        if (autoSpeak && !muted) {
          speakText(data.translation);
        }

        if (joinedRoom && channelRef.current) {
          channelRef.current.send({
            type: "broadcast",
            event: "utterance",
            payload: {
              userId: userId.current,
              text,
              sourceLang: autoDetect ? "" : sourceLang
            }
          });
        }

        setMessages((prev) => [
          {
            id: `self-${Date.now()}`,
            from: "You",
            text,
            translation: data.translation
          },
          ...prev
        ]);

        if (logUtterance) {
          setUtteranceLog((prev) => [
            {
              id: `utt-${Date.now()}`,
              text,
              translation: data.translation
            },
            ...prev
          ]);
        }
      } else {
        setStatus(data.error || "Translation error");
      }
    } catch (error) {
      setStatus(error.message || "Translation error");
    }
  };

  const handleIncomingUtterance = async (data) => {
    if (!data.text) return;

    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: data.text,
          sourceLang: data.sourceLang,
          targetLang
        })
      });
      const result = await response.json();
      if (response.ok) {
        setMessages((prev) => [
          {
            id: `${data.userId}-${Date.now()}`,
            from: data.userId,
            text: data.text,
            translation: result.translation
          },
          ...prev
        ]);

        if (autoSpeak && !muted) {
          speakText(result.translation);
        }
      }
    } catch (error) {
      setStatus(error.message || "Incoming translation error");
    }
  };

  const startListening = () => {
    if (!recognitionRef.current || isListening) return;
    micWantedRef.current = true;
    try {
      recognitionRef.current.start();
    } catch (error) {
      setStatus("Mic error");
      setIsListening(false);
    }
  };

  const stopListening = () => {
    micWantedRef.current = false;
    if (!recognitionRef.current || !isListening) return;
    recognitionRef.current.stop();
  };

  const resetTranscripts = () => {
    setTranscript("");
    setFinalTranscript("");
    setLastUtterance("");
    setTranslation("");
    setMessages([]);
    setUtteranceLog([]);
  };

  const speakText = (text) => {
    if (!capabilities.speechSynthesis || !text) return;

    const utterance = new SpeechSynthesisUtterance(text);
    if (selectedVoice) {
      utterance.voice = selectedVoice;
    } else {
      utterance.lang = targetLang || "en";
    }

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  const handleJoinRoom = () => {
    if (!roomId.trim()) return;
    if (!supabaseConfigured) {
      setCallStatus("Supabase is not configured.");
      return;
    }
    setJoinedRoom(true);
  };

  const handleLeaveRoom = () => {
    setJoinedRoom(false);
    cleanupRoom();
  };

  const handleTypedSubmit = () => {
    if (!typedInput.trim()) return;
    translateText(typedInput.trim(), { logUtterance: true });
    setTypedInput("");
  };

  return (
    <main>
      <div className="app-shell">
        <section className="hero">
          <span className="badge">Realtime speech translation</span>
          <h1 className="hero-title">Live Lingo</h1>
          <p>
            Speak naturally, choose a language, and get instant translation with
            voice playback. Group mode lets everyone listen in their own
            language across devices.
          </p>
          <div className="controls">
            <button
              onClick={startListening}
              disabled={!capabilities.speechRecognition || isListening}
            >
              Start mic
            </button>
            <button
              className="secondary"
              onClick={stopListening}
              disabled={!capabilities.speechRecognition || !isListening}
            >
              Stop mic
            </button>
            <button className="ghost" onClick={resetTranscripts}>
              Clear
            </button>
            <button
              className="ghost"
              onClick={() => setAutoRestartMic((prev) => !prev)}
              disabled={!capabilities.speechRecognition}
            >
              Auto-restart mic: {autoRestartMic ? "On" : "Off"}
            </button>
            <span className="badge">Status: {status}</span>
            {latencyMs !== null && (
              <span className="badge">Latency: {latencyMs} ms</span>
            )}
          </div>
        </section>

        <section className="grid">
          <div className="card stack">
            <div>
              <span className="label">Speak in</span>
              <select
                value={sourceLang}
                onChange={(event) => setSourceLang(event.target.value)}
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span className="label">Translate to</span>
              <select
                value={targetLang}
                onChange={(event) => setTargetLang(event.target.value)}
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="controls">
              <button
                className="secondary"
                onClick={() => setAutoDetect((prev) => !prev)}
              >
                Auto-detect source: {autoDetect ? "On" : "Off"}
              </button>
              <button
                className="secondary"
                onClick={() =>
                  setTranslateMode((prev) =>
                    prev === "utterance" ? "full" : "utterance"
                  )
                }
              >
                Translate mode: {translateMode === "utterance" ? "Utterance" : "Full transcript"}
              </button>
            </div>
            <div>
              <div className="controls">
                <span className="label">Voice</span>
                <button
                  className="ghost"
                  type="button"
                  onClick={() => setShowAudioHelp(true)}
                >
                  Audio help
                </button>
              </div>
              <select
                value={voiceUri}
                onChange={(event) => setVoiceUri(event.target.value)}
                onFocus={refreshVoices}
              >
                <option value="">Auto select</option>
                {availableVoices.map((voice) => (
                  <option key={voice.voiceURI} value={voice.voiceURI}>
                    {voice.name} ({voice.lang})
                  </option>
                ))}
              </select>
            </div>
            <div className="controls">
              <button
                className="secondary"
                onClick={() => setAutoSpeak((prev) => !prev)}
              >
                Auto speak: {autoSpeak ? "On" : "Off"}
              </button>
              <button
                className="secondary"
                onClick={() => setMuted((prev) => !prev)}
              >
                Mute: {muted ? "On" : "Off"}
              </button>
            </div>
            <p>
              Browser support: speech recognition {capabilities.speechRecognition ? "yes" : "no"},
              speech synthesis {capabilities.speechSynthesis ? "yes" : "no"}.
            </p>
          </div>

          <div className="card stack">
            <div>
              <span className="label">Live transcript</span>
              <div className="transcript">{transcript || "..."}</div>
            </div>
            <div>
              <span className="label">Final transcript</span>
              <div className="transcript">{finalTranscript || "..."}</div>
            </div>
            <div>
              <span className="label">Type to translate</span>
              <textarea
                rows={3}
                value={typedInput}
                onChange={(event) => setTypedInput(event.target.value)}
                placeholder="Type a message if you prefer not to use the mic."
              />
              <div className="controls">
                <button className="secondary" onClick={handleTypedSubmit}>
                  Translate text
                </button>
              </div>
            </div>
          </div>

          <div className="card stack">
            <div>
              <span className="label">Translation</span>
              <div className="transcript">{translation || "..."}</div>
              <span className="badge">Provider: {provider}</span>
            </div>
            {provider === "stub" && (
              <p>Translation provider is set to stub. Configure a real provider to translate.</p>
            )}
            <div className="controls">
              <button
                className="secondary"
                onClick={() => speakText(translation)}
                disabled={!translation}
              >
                Speak translation
              </button>
              <button
                className="secondary"
                onClick={() =>
                  translateText(activeSpeechText, {
                    logUtterance: translateMode === "utterance"
                  })
                }
                disabled={!canTranslate}
              >
                Re-translate
              </button>
            </div>
            <p>
              Translating from {languageName(sourceLang)} to {languageName(targetLang)}.
            </p>
            <div>
              <span className="label">Utterance log</span>
              <div className="list">
                {utteranceLog.length === 0 && (
                  <div className="list-item">No utterances yet.</div>
                )}
                {utteranceLog.map((entry) => (
                  <div className="list-item" key={entry.id}>
                    <div>Original: {entry.text}</div>
                    <div>Translated: {entry.translation}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="card stack">
          <h2>Group room</h2>
          <p>
            Share a room name to broadcast your speech to other devices. Each
            member translates to their own selected language.
          </p>
          {isLocalhost && (
            <p>
              You are on localhost. Other devices cannot reach this address.
              Open the app using your computer's LAN IP (for example,
              `http://192.168.x.x:3000`) and keep the same room name.
            </p>
          )}
          <div className="split">
            <div className="stack">
              <span className="label">Room name</span>
              <input
                value={roomId}
                onChange={(event) => setRoomId(event.target.value)}
                placeholder="studio"
              />
              <div>
                <span className="label">Share link</span>
                <div className="controls">
                  <input value={roomLink} readOnly placeholder="Room link appears here" />
                  <button className="secondary" onClick={handleCopyLink} disabled={!roomLink}>
                    Copy link
                  </button>
                </div>
              </div>
              <div className="controls">
                <button onClick={handleJoinRoom} disabled={joinedRoom}>
                  Join room
                </button>
                <button
                  className="secondary"
                  onClick={handleLeaveRoom}
                  disabled={!joinedRoom}
                >
                  Leave room
                </button>
                <span className="badge">
                  {joinedRoom ? "Connected" : "Not connected"}
                </span>
                <span className="badge">Transport: {transport}</span>
                <span className="badge">Room: {connectionState}</span>
                {callStatus && <span className="badge">{callStatus}</span>}
              </div>
            </div>
            <div>
              <span className="label">Participants</span>
              <div className="list">
                <div className="list-item">
                  You ({languageName(targetLang)})
                </div>
                {participants.map((participant) => (
                  <div className="list-item" key={participant.userId}>
                    Guest {participant.userId.slice(0, 6)} ({languageName(participant.targetLang)})
                  </div>
                ))}
              </div>
              <div>
                <span className="label">Live call audio</span>
                <div className="list">
                  {remoteStreams.length === 0 && (
                    <div className="list-item">No active audio streams yet.</div>
                  )}
                  {remoteStreams.map((entry) => (
                    <div className="list-item" key={entry.userId}>
                      Listening to {entry.userId.slice(0, 6)}
                      <audio
                        autoPlay
                        playsInline
                        ref={(el) => {
                          if (el && entry.stream) {
                            el.srcObject = entry.stream;
                          }
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="card stack">
          <h2>Room translations</h2>
          <div className="list">
            {messages.length === 0 && (
              <div className="list-item">No room messages yet.</div>
            )}
            {messages.map((message) => (
              <div className="list-item" key={message.id}>
                <strong>From {message.from.slice(0, 6)}</strong>
                <div>Original: {message.text}</div>
                <div>Translated: {message.translation}</div>
              </div>
            ))}
          </div>
        </section>

        <footer>
          Tips: Use headphones to reduce echo. For production, add auth,
          rate-limits, and persistent room storage.
        </footer>
      {showAudioHelp && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="controls">
              <strong>Audio device help</strong>
              <button
                className="ghost"
                type="button"
                onClick={() => setShowAudioHelp(false)}
              >
                Close
              </button>
            </div>
            <p>
              Browsers do not allow web apps to force a specific microphone or
              speaker for speech recognition and speech synthesis. To use a
              Bluetooth device, set it as the system default input/output and
              reload the page.
            </p>
            <p>Steps (Chrome/Edge):</p>
            <p>1. Open your OS sound settings and set the Bluetooth device as the default input and output.</p>
            <p>2. In the browser, open the site settings for the microphone and allow access if prompted.</p>
            <p>3. Refresh this page to pick up the new defaults.</p>
          </div>
        </div>
      )}
      </div>
    </main>
  );
}
