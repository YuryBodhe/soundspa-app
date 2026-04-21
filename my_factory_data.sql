--
-- PostgreSQL database dump
--

\restrict nWrMNgheT3Y0DHgfRXJvWVgZFq07y5TB0cRIggeAY7ZH2uvkvNrmR2sjTt3etNN

-- Dumped from database version 16.13 (Homebrew)
-- Dumped by pg_dump version 16.13 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: __drizzle_migrations; Type: TABLE DATA; Schema: drizzle; Owner: bodhem3
--



--
-- Data for Name: tenants; Type: TABLE DATA; Schema: public; Owner: bodhem3
--

INSERT INTO public.tenants VALUES (3, 'Soundspa', 'soundspa', 'Soundspa', '2026-04-07 20:20:38.847+07', '2026-04-17 20:20:38.847+07', NULL, '2026-04-20 11:52:52.376723+07');
INSERT INTO public.tenants VALUES (1, 'Salon Test#3', 'soundspa-main', 'Soundspa Main', '2026-04-07 15:47:16.752+07', '2026-04-17 15:47:16.752+07', '2026-05-13 00:00:00+07', '2026-04-20 11:52:52.376723+07');


--
-- Data for Name: agent_actions; Type: TABLE DATA; Schema: public; Owner: bodhem3
--



--
-- Data for Name: agents; Type: TABLE DATA; Schema: public; Owner: bodhem3
--

INSERT INTO public.agents VALUES (1, NULL, 'watcher', 'Роль: Ты — системный контролер (Watcher) автономной экосистемы SoundSpa.

Контекст: Ты анализируешь технические логи музыкальных плееров в реальном времени.

Твоя инструкция:

Если данные показывают Offline или отсутствие пинга более 10 минут — это критическое событие.

Проанализируй причину (низкий заряд, ошибка сети, диск заполнен).

Твой ответ должен быть в формате:

STATUS: [OK или ALARM]

SUMMARY: Краткая суть проблемы на русском языке.

ACTION: Что нужно сделать (например: "Перезагрузить роутер" или "Очистить кэш").

Тон: Сухой, профессиональный, ориентированный на результат. Ты помогаешь владельцу бизнеса минимизировать простои и не терять деньги.', true, 'nvidia/nemotron-3-super-120b-a12b:free', 0);


--
-- Data for Name: channels; Type: TABLE DATA; Schema: public; Owner: bodhem3
--

INSERT INTO public.channels VALUES (8, 'night_ambience', 'night-ambience', 'Night Ambience', 'Ambient · Night', 'noise', 'https://radio.bodhemusic.com/listen/night_ambience/radio.mp3', '/noise-night.jpg', 12, false);
INSERT INTO public.channels VALUES (1, 'deep_relax', 'deep-relax', 'Deep Relax Mix', 'Relaxing · Live', 'music', 'https://radio.bodhemusic.com/listen/deep_relax/radio.mp3', '/channel-1.jpg', 1, false);
INSERT INTO public.channels VALUES (2, 'spaquatoria_healing', 'spaquatoria-healing', 'Healing Mix', 'Deep · Live', 'music', 'https://radio.bodhemusic.com/listen/spaquatoria_healing/radio.mp3', '/channel-2.jpg', 2, false);
INSERT INTO public.channels VALUES (3, 'dynamic_spa', 'dynamic-spa', 'Dynamic Spa Mix', 'Energizing · Live', 'music', 'https://radio.bodhemusic.com/listen/dynamic_spa/radio.mp3', '/channel-3.jpg', 3, false);
INSERT INTO public.channels VALUES (4, 'divnitsa', 'divnitsa', 'Дивница', 'Signature · Live', 'music', 'https://radio.bodhemusic.com/listen/divnitsa/radio.mp3', '/channel-divnitsa.jpg', 4, false);
INSERT INTO public.channels VALUES (6, 'forest_ambience', 'forest-ambience', 'Forest Ambience', 'Ambient · Forest', 'noise', 'https://radio.bodhemusic.com/listen/forest_ambience/radio.mp3', '/noise-forest.jpg', 10, false);
INSERT INTO public.channels VALUES (7, 'sea_ambience', 'sea-ambience', 'Sea Ambience', 'Ambient · Sea', 'noise', 'https://radio.bodhemusic.com/listen/sea_ambience/radio.mp3', '/noise-sea.jpg', 11, false);


--
-- Data for Name: invites; Type: TABLE DATA; Schema: public; Owner: bodhem3
--

INSERT INTO public.invites VALUES (1, 'SOUNDSPA-TEST', 100, 3, NULL);


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: bodhem3
--

INSERT INTO public.users VALUES (5, 'yurybodhe@gmail.com', 'magic-link-only', 3);


--
-- Data for Name: login_tokens; Type: TABLE DATA; Schema: public; Owner: bodhem3
--

INSERT INTO public.login_tokens VALUES (34, '5046eae112125c5568c66430eb2da365281655cbdfff7083a56dcbb682d059c4', 5, '2026-04-08 14:27:57.971+07', '2026-04-08 13:58:19.6+07');
INSERT INTO public.login_tokens VALUES (16, '88720966ba2d1affea0b9a786dcb8fc35e82b8a69dcfee60750383c2b71e7815', 5, '2026-04-08 20:20:38.847+07', '2026-04-07 20:21:01.181+07');
INSERT INTO public.login_tokens VALUES (17, '22ad2f3df85ffb3621fec7be3af7f04f02879f06e53bc470efc11bbcf231b4e5', 5, '2026-04-07 20:57:06.991+07', '2026-04-07 20:27:27.137+07');
INSERT INTO public.login_tokens VALUES (18, '5d9deb8e515b1c82f06023a87efa0b47b1ee5ec149292a17d4b543fb1f0373cb', 5, '2026-04-07 21:00:58.83+07', '2026-04-07 20:31:17.709+07');
INSERT INTO public.login_tokens VALUES (30, '883c47f21ac66a8d0f755d09221eda3a62ff3bc11a5625a2573641c141980525', 5, '2026-04-08 13:08:11.295+07', '2026-04-08 12:38:31.821+07');
INSERT INTO public.login_tokens VALUES (31, 'd8a7cc9df5a474c401175c8e038f09dd9461679dbc97f3f5bf3d0d5eaa80a6f0', 5, '2026-04-08 14:22:10.16+07', '2026-04-08 13:52:29.318+07');
INSERT INTO public.login_tokens VALUES (33, '771f5d65cd485fd67d07b27936c4f8fc558e919a38fe9794865f3998e09a2a28', 5, '2026-04-08 14:26:59.571+07', '2026-04-08 13:57:14.185+07');
INSERT INTO public.login_tokens VALUES (40, 'c6fd2726eb7d093eb26f8103f0ed113a1f60730cae7d63b489a864e23f8b52fa', 5, '2026-04-08 18:44:09.998+07', '2026-04-08 18:14:23.452+07');


--
-- Data for Name: monitoring_current; Type: TABLE DATA; Schema: public; Owner: bodhem3
--

INSERT INTO public.monitoring_current VALUES (1, 'paused', '2026-04-20 18:22:57.342+07', '{"device": "Desktop-Player", "noiseId": null, "version": "1.1.0", "channelId": null, "sessionId": "sess_zdrtw4x_1776679640276"}');


--
-- Data for Name: monitoring_logs; Type: TABLE DATA; Schema: public; Owner: bodhem3
--

INSERT INTO public.monitoring_logs VALUES (1, 1, 'ping', 'info', '{"channel":"Deep House Radio","uptime":"12400s","device":"MacBook Air"}', '2026-04-20 15:01:10.813031+07');
INSERT INTO public.monitoring_logs VALUES (2, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:08:20.572958+07');
INSERT INTO public.monitoring_logs VALUES (3, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:08:20.574462+07');
INSERT INTO public.monitoring_logs VALUES (4, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:09:20.33137+07');
INSERT INTO public.monitoring_logs VALUES (5, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:09:20.333373+07');
INSERT INTO public.monitoring_logs VALUES (6, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:10:20.316565+07');
INSERT INTO public.monitoring_logs VALUES (7, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:10:20.317014+07');
INSERT INTO public.monitoring_logs VALUES (8, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:11:20.316327+07');
INSERT INTO public.monitoring_logs VALUES (9, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:11:20.316843+07');
INSERT INTO public.monitoring_logs VALUES (10, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:12:20.312871+07');
INSERT INTO public.monitoring_logs VALUES (11, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:12:20.3135+07');
INSERT INTO public.monitoring_logs VALUES (12, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:13:20.313491+07');
INSERT INTO public.monitoring_logs VALUES (13, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:13:20.313907+07');
INSERT INTO public.monitoring_logs VALUES (14, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:14:57.318886+07');
INSERT INTO public.monitoring_logs VALUES (15, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:14:57.319521+07');
INSERT INTO public.monitoring_logs VALUES (16, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:15:57.316821+07');
INSERT INTO public.monitoring_logs VALUES (17, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:15:57.317248+07');
INSERT INTO public.monitoring_logs VALUES (18, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:16:57.324945+07');
INSERT INTO public.monitoring_logs VALUES (19, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:16:57.325385+07');
INSERT INTO public.monitoring_logs VALUES (20, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:17:57.327534+07');
INSERT INTO public.monitoring_logs VALUES (21, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:17:57.32793+07');
INSERT INTO public.monitoring_logs VALUES (22, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:18:57.330669+07');
INSERT INTO public.monitoring_logs VALUES (23, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:18:57.331089+07');
INSERT INTO public.monitoring_logs VALUES (24, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:19:57.331159+07');
INSERT INTO public.monitoring_logs VALUES (25, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:19:57.331559+07');
INSERT INTO public.monitoring_logs VALUES (26, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:20:57.326657+07');
INSERT INTO public.monitoring_logs VALUES (27, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:20:57.327126+07');
INSERT INTO public.monitoring_logs VALUES (28, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:21:57.328181+07');
INSERT INTO public.monitoring_logs VALUES (29, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:21:57.328548+07');
INSERT INTO public.monitoring_logs VALUES (30, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:22:57.327052+07');
INSERT INTO public.monitoring_logs VALUES (31, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:22:57.327514+07');
INSERT INTO public.monitoring_logs VALUES (32, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:23:57.331276+07');
INSERT INTO public.monitoring_logs VALUES (33, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:23:57.331804+07');
INSERT INTO public.monitoring_logs VALUES (34, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:24:57.328727+07');
INSERT INTO public.monitoring_logs VALUES (35, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:24:57.329109+07');
INSERT INTO public.monitoring_logs VALUES (36, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:25:57.326332+07');
INSERT INTO public.monitoring_logs VALUES (37, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:25:57.326713+07');
INSERT INTO public.monitoring_logs VALUES (38, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:26:57.331942+07');
INSERT INTO public.monitoring_logs VALUES (39, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:26:57.332396+07');
INSERT INTO public.monitoring_logs VALUES (40, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:27:57.328315+07');
INSERT INTO public.monitoring_logs VALUES (41, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:27:57.328769+07');
INSERT INTO public.monitoring_logs VALUES (42, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:28:57.344975+07');
INSERT INTO public.monitoring_logs VALUES (43, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:28:57.345888+07');
INSERT INTO public.monitoring_logs VALUES (44, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:29:57.324304+07');
INSERT INTO public.monitoring_logs VALUES (45, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:29:57.324664+07');
INSERT INTO public.monitoring_logs VALUES (47, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:30:57.32504+07');
INSERT INTO public.monitoring_logs VALUES (46, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:30:57.324564+07');
INSERT INTO public.monitoring_logs VALUES (48, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:31:57.394687+07');
INSERT INTO public.monitoring_logs VALUES (49, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:31:57.395035+07');
INSERT INTO public.monitoring_logs VALUES (50, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:32:57.395104+07');
INSERT INTO public.monitoring_logs VALUES (51, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:32:57.395697+07');
INSERT INTO public.monitoring_logs VALUES (52, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:33:57.395328+07');
INSERT INTO public.monitoring_logs VALUES (53, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:33:57.395761+07');
INSERT INTO public.monitoring_logs VALUES (54, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:34:57.395343+07');
INSERT INTO public.monitoring_logs VALUES (55, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:34:57.395693+07');
INSERT INTO public.monitoring_logs VALUES (56, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:35:57.395811+07');
INSERT INTO public.monitoring_logs VALUES (57, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:35:57.39615+07');
INSERT INTO public.monitoring_logs VALUES (58, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:36:57.397221+07');
INSERT INTO public.monitoring_logs VALUES (59, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:36:57.397681+07');
INSERT INTO public.monitoring_logs VALUES (60, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:37:57.39855+07');
INSERT INTO public.monitoring_logs VALUES (61, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:37:57.398895+07');
INSERT INTO public.monitoring_logs VALUES (62, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:38:57.396068+07');
INSERT INTO public.monitoring_logs VALUES (63, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:38:57.396436+07');
INSERT INTO public.monitoring_logs VALUES (64, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:39:57.400385+07');
INSERT INTO public.monitoring_logs VALUES (65, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:39:57.40073+07');
INSERT INTO public.monitoring_logs VALUES (66, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:40:57.400188+07');
INSERT INTO public.monitoring_logs VALUES (67, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:40:57.400563+07');
INSERT INTO public.monitoring_logs VALUES (68, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:41:57.397829+07');
INSERT INTO public.monitoring_logs VALUES (69, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:41:57.398176+07');
INSERT INTO public.monitoring_logs VALUES (70, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:42:57.400023+07');
INSERT INTO public.monitoring_logs VALUES (71, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:42:57.400362+07');
INSERT INTO public.monitoring_logs VALUES (72, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:43:57.399759+07');
INSERT INTO public.monitoring_logs VALUES (73, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:43:57.400208+07');
INSERT INTO public.monitoring_logs VALUES (74, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:44:57.403528+07');
INSERT INTO public.monitoring_logs VALUES (75, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:44:57.403856+07');
INSERT INTO public.monitoring_logs VALUES (76, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:45:57.401567+07');
INSERT INTO public.monitoring_logs VALUES (77, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:45:57.401893+07');
INSERT INTO public.monitoring_logs VALUES (78, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:46:57.400355+07');
INSERT INTO public.monitoring_logs VALUES (79, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:46:57.400709+07');
INSERT INTO public.monitoring_logs VALUES (80, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:47:57.401754+07');
INSERT INTO public.monitoring_logs VALUES (81, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:47:57.40212+07');
INSERT INTO public.monitoring_logs VALUES (82, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:48:57.401411+07');
INSERT INTO public.monitoring_logs VALUES (83, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:48:57.401739+07');
INSERT INTO public.monitoring_logs VALUES (84, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:49:57.400577+07');
INSERT INTO public.monitoring_logs VALUES (85, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:49:57.400938+07');
INSERT INTO public.monitoring_logs VALUES (86, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:50:57.402616+07');
INSERT INTO public.monitoring_logs VALUES (87, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:50:57.402946+07');
INSERT INTO public.monitoring_logs VALUES (88, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:51:57.401944+07');
INSERT INTO public.monitoring_logs VALUES (89, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:51:57.40231+07');
INSERT INTO public.monitoring_logs VALUES (90, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:52:57.404709+07');
INSERT INTO public.monitoring_logs VALUES (91, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:52:57.405062+07');
INSERT INTO public.monitoring_logs VALUES (92, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:53:57.404061+07');
INSERT INTO public.monitoring_logs VALUES (93, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:53:57.404561+07');
INSERT INTO public.monitoring_logs VALUES (94, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:54:57.403399+07');
INSERT INTO public.monitoring_logs VALUES (95, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:54:57.403819+07');
INSERT INTO public.monitoring_logs VALUES (96, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:55:57.404009+07');
INSERT INTO public.monitoring_logs VALUES (97, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:55:57.404333+07');
INSERT INTO public.monitoring_logs VALUES (98, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:56:57.403972+07');
INSERT INTO public.monitoring_logs VALUES (99, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:56:57.404306+07');
INSERT INTO public.monitoring_logs VALUES (100, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:57:57.410095+07');
INSERT INTO public.monitoring_logs VALUES (101, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:57:57.410479+07');
INSERT INTO public.monitoring_logs VALUES (102, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:58:57.405008+07');
INSERT INTO public.monitoring_logs VALUES (103, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:58:57.405786+07');
INSERT INTO public.monitoring_logs VALUES (104, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:59:57.404387+07');
INSERT INTO public.monitoring_logs VALUES (105, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 17:59:57.404789+07');
INSERT INTO public.monitoring_logs VALUES (106, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:00:57.406737+07');
INSERT INTO public.monitoring_logs VALUES (107, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:00:57.407138+07');
INSERT INTO public.monitoring_logs VALUES (108, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:01:57.408872+07');
INSERT INTO public.monitoring_logs VALUES (109, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:01:57.409288+07');
INSERT INTO public.monitoring_logs VALUES (110, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:02:57.353071+07');
INSERT INTO public.monitoring_logs VALUES (111, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:02:57.353479+07');
INSERT INTO public.monitoring_logs VALUES (112, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:03:57.353172+07');
INSERT INTO public.monitoring_logs VALUES (113, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:03:57.353569+07');
INSERT INTO public.monitoring_logs VALUES (114, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:04:57.354185+07');
INSERT INTO public.monitoring_logs VALUES (115, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:04:57.35458+07');
INSERT INTO public.monitoring_logs VALUES (116, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:05:57.35464+07');
INSERT INTO public.monitoring_logs VALUES (117, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:05:57.355085+07');
INSERT INTO public.monitoring_logs VALUES (118, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:06:57.354576+07');
INSERT INTO public.monitoring_logs VALUES (119, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:06:57.354896+07');
INSERT INTO public.monitoring_logs VALUES (120, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:07:57.353093+07');
INSERT INTO public.monitoring_logs VALUES (121, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:07:57.353444+07');
INSERT INTO public.monitoring_logs VALUES (122, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:08:57.353295+07');
INSERT INTO public.monitoring_logs VALUES (123, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:08:57.353649+07');
INSERT INTO public.monitoring_logs VALUES (124, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:09:57.352749+07');
INSERT INTO public.monitoring_logs VALUES (125, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:09:57.35307+07');
INSERT INTO public.monitoring_logs VALUES (126, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:10:57.37215+07');
INSERT INTO public.monitoring_logs VALUES (127, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:10:57.377001+07');
INSERT INTO public.monitoring_logs VALUES (128, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:11:57.352652+07');
INSERT INTO public.monitoring_logs VALUES (129, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:11:57.353074+07');
INSERT INTO public.monitoring_logs VALUES (130, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:12:57.352302+07');
INSERT INTO public.monitoring_logs VALUES (131, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:12:57.352632+07');
INSERT INTO public.monitoring_logs VALUES (132, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:13:57.352253+07');
INSERT INTO public.monitoring_logs VALUES (133, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:13:57.352675+07');
INSERT INTO public.monitoring_logs VALUES (134, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:14:57.350468+07');
INSERT INTO public.monitoring_logs VALUES (135, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:14:57.351044+07');
INSERT INTO public.monitoring_logs VALUES (136, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:15:57.353762+07');
INSERT INTO public.monitoring_logs VALUES (137, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:15:57.354136+07');
INSERT INTO public.monitoring_logs VALUES (138, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:16:57.351163+07');
INSERT INTO public.monitoring_logs VALUES (139, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:16:57.35149+07');
INSERT INTO public.monitoring_logs VALUES (140, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:17:57.354473+07');
INSERT INTO public.monitoring_logs VALUES (141, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:17:57.354923+07');
INSERT INTO public.monitoring_logs VALUES (142, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:18:57.351413+07');
INSERT INTO public.monitoring_logs VALUES (143, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:18:57.351759+07');
INSERT INTO public.monitoring_logs VALUES (144, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:19:57.351278+07');
INSERT INTO public.monitoring_logs VALUES (145, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:19:57.351606+07');
INSERT INTO public.monitoring_logs VALUES (146, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:20:57.353396+07');
INSERT INTO public.monitoring_logs VALUES (147, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:20:57.353872+07');
INSERT INTO public.monitoring_logs VALUES (148, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:21:57.35468+07');
INSERT INTO public.monitoring_logs VALUES (149, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:21:57.355002+07');
INSERT INTO public.monitoring_logs VALUES (150, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:22:57.350752+07');
INSERT INTO public.monitoring_logs VALUES (151, 1, 'ping', 'info', '{"sessionId":"sess_zdrtw4x_1776679640276","channelId":null,"noiseId":null,"device":"Desktop-Player","version":"1.1.0"}', '2026-04-20 18:22:57.351116+07');


--
-- Data for Name: payments; Type: TABLE DATA; Schema: public; Owner: bodhem3
--



--
-- Data for Name: tenant_channels; Type: TABLE DATA; Schema: public; Owner: bodhem3
--

INSERT INTO public.tenant_channels VALUES (1, 1, 1);
INSERT INTO public.tenant_channels VALUES (1, 2, 2);
INSERT INTO public.tenant_channels VALUES (1, 3, 3);
INSERT INTO public.tenant_channels VALUES (1, 4, 4);
INSERT INTO public.tenant_channels VALUES (3, 1, 1);
INSERT INTO public.tenant_channels VALUES (3, 2, 2);
INSERT INTO public.tenant_channels VALUES (3, 3, 3);
INSERT INTO public.tenant_channels VALUES (1, 6, 5);
INSERT INTO public.tenant_channels VALUES (1, 7, 6);
INSERT INTO public.tenant_channels VALUES (1, 8, 7);


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE SET; Schema: drizzle; Owner: bodhem3
--

SELECT pg_catalog.setval('drizzle.__drizzle_migrations_id_seq', 1, false);


--
-- Name: agent_actions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: bodhem3
--

SELECT pg_catalog.setval('public.agent_actions_id_seq', 1, false);


--
-- Name: agents_id_seq; Type: SEQUENCE SET; Schema: public; Owner: bodhem3
--

SELECT pg_catalog.setval('public.agents_id_seq', 1, true);


--
-- Name: channels_id_seq; Type: SEQUENCE SET; Schema: public; Owner: bodhem3
--

SELECT pg_catalog.setval('public.channels_id_seq', 8, true);


--
-- Name: invites_id_seq; Type: SEQUENCE SET; Schema: public; Owner: bodhem3
--

SELECT pg_catalog.setval('public.invites_id_seq', 1, true);


--
-- Name: login_tokens_id_seq; Type: SEQUENCE SET; Schema: public; Owner: bodhem3
--

SELECT pg_catalog.setval('public.login_tokens_id_seq', 41, true);


--
-- Name: monitoring_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: bodhem3
--

SELECT pg_catalog.setval('public.monitoring_logs_id_seq', 151, true);


--
-- Name: payments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: bodhem3
--

SELECT pg_catalog.setval('public.payments_id_seq', 1, false);


--
-- Name: tenants_id_seq; Type: SEQUENCE SET; Schema: public; Owner: bodhem3
--

SELECT pg_catalog.setval('public.tenants_id_seq', 3, true);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: bodhem3
--

SELECT pg_catalog.setval('public.users_id_seq', 5, true);


--
-- PostgreSQL database dump complete
--

\unrestrict nWrMNgheT3Y0DHgfRXJvWVgZFq07y5TB0cRIggeAY7ZH2uvkvNrmR2sjTt3etNN

