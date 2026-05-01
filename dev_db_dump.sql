--
-- PostgreSQL database dump
--

\restrict dFbl6bgBcj2LcLIX4EbafCzAfZkf7hB3mJbJcseI8WDycBWEqqGihFJI6QoUyGW

-- Dumped from database version 16.13
-- Dumped by pg_dump version 16.13

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
-- Name: drizzle; Type: SCHEMA; Schema: -; Owner: soundspa
--

CREATE SCHEMA drizzle;


ALTER SCHEMA drizzle OWNER TO soundspa;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: __drizzle_migrations; Type: TABLE; Schema: drizzle; Owner: soundspa
--

CREATE TABLE drizzle.__drizzle_migrations (
    id character varying NOT NULL,
    hash character varying NOT NULL,
    created_at bigint NOT NULL
);


ALTER TABLE drizzle.__drizzle_migrations OWNER TO soundspa;

--
-- Name: agent_actions; Type: TABLE; Schema: public; Owner: soundspa
--

CREATE TABLE public.agent_actions (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    agent_role text NOT NULL,
    action text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    external_id text,
    error text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    executed_at timestamp with time zone
);


ALTER TABLE public.agent_actions OWNER TO soundspa;

--
-- Name: agent_actions_id_seq; Type: SEQUENCE; Schema: public; Owner: soundspa
--

CREATE SEQUENCE public.agent_actions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.agent_actions_id_seq OWNER TO soundspa;

--
-- Name: agent_actions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: soundspa
--

ALTER SEQUENCE public.agent_actions_id_seq OWNED BY public.agent_actions.id;


--
-- Name: agents; Type: TABLE; Schema: public; Owner: soundspa
--

CREATE TABLE public.agents (
    id integer NOT NULL,
    tenant_id integer,
    name text NOT NULL,
    model text DEFAULT 'nvidia/nemotron-3-super-120b-a12b:free'::text,
    temperature real DEFAULT 0,
    system_prompt text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    kind text DEFAULT 'watcher'::text NOT NULL
);


ALTER TABLE public.agents OWNER TO soundspa;

--
-- Name: agents_id_seq; Type: SEQUENCE; Schema: public; Owner: soundspa
--

CREATE SEQUENCE public.agents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.agents_id_seq OWNER TO soundspa;

--
-- Name: agents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: soundspa
--

ALTER SEQUENCE public.agents_id_seq OWNED BY public.agents.id;


--
-- Name: channels; Type: TABLE; Schema: public; Owner: soundspa
--

CREATE TABLE public.channels (
    id integer NOT NULL,
    code text NOT NULL,
    slug text NOT NULL,
    display_name text NOT NULL,
    mood text,
    kind text DEFAULT 'music'::text NOT NULL,
    stream_url text NOT NULL,
    image text,
    "order" integer DEFAULT 0 NOT NULL,
    is_new boolean DEFAULT false NOT NULL
);


ALTER TABLE public.channels OWNER TO soundspa;

--
-- Name: channels_id_seq; Type: SEQUENCE; Schema: public; Owner: soundspa
--

CREATE SEQUENCE public.channels_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.channels_id_seq OWNER TO soundspa;

--
-- Name: channels_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: soundspa
--

ALTER SEQUENCE public.channels_id_seq OWNED BY public.channels.id;


--
-- Name: invites; Type: TABLE; Schema: public; Owner: soundspa
--

CREATE TABLE public.invites (
    id integer NOT NULL,
    code text NOT NULL,
    max_uses integer,
    used_count integer DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone,
    tenant_id integer,
    issued_to text,
    created_by_user_id integer,
    used_by_tenant_id integer,
    used_by_user_id integer,
    base_label text,
    rotation_interval_months integer,
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.invites OWNER TO soundspa;

--
-- Name: invites_id_seq; Type: SEQUENCE; Schema: public; Owner: soundspa
--

CREATE SEQUENCE public.invites_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.invites_id_seq OWNER TO soundspa;

--
-- Name: invites_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: soundspa
--

ALTER SEQUENCE public.invites_id_seq OWNED BY public.invites.id;


--
-- Name: login_tokens; Type: TABLE; Schema: public; Owner: soundspa
--

CREATE TABLE public.login_tokens (
    id integer NOT NULL,
    token text NOT NULL,
    user_id integer NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone
);


ALTER TABLE public.login_tokens OWNER TO soundspa;

--
-- Name: login_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: soundspa
--

CREATE SEQUENCE public.login_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.login_tokens_id_seq OWNER TO soundspa;

--
-- Name: login_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: soundspa
--

ALTER SEQUENCE public.login_tokens_id_seq OWNED BY public.login_tokens.id;


--
-- Name: monitoring_current; Type: TABLE; Schema: public; Owner: soundspa
--

CREATE TABLE public.monitoring_current (
    tenant_id integer NOT NULL,
    status text DEFAULT 'offline'::text NOT NULL,
    last_ping timestamp with time zone DEFAULT now(),
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


ALTER TABLE public.monitoring_current OWNER TO soundspa;

--
-- Name: monitoring_logs; Type: TABLE; Schema: public; Owner: soundspa
--

CREATE TABLE public.monitoring_logs (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    event text NOT NULL,
    level text DEFAULT 'info'::text,
    details text,
    created_at timestamp with time zone DEFAULT now(),
    event_type text,
    session_id text,
    channel_id text,
    user_agent text,
    client_type text,
    is_buffering boolean DEFAULT false NOT NULL,
    noise_id text
);


ALTER TABLE public.monitoring_logs OWNER TO soundspa;

--
-- Name: monitoring_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: soundspa
--

CREATE SEQUENCE public.monitoring_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.monitoring_logs_id_seq OWNER TO soundspa;

--
-- Name: monitoring_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: soundspa
--

ALTER SEQUENCE public.monitoring_logs_id_seq OWNED BY public.monitoring_logs.id;


--
-- Name: monitoring_reports; Type: TABLE; Schema: public; Owner: soundspa
--

CREATE TABLE public.monitoring_reports (
    id integer NOT NULL,
    tenant_id integer,
    agent_name text NOT NULL,
    type text DEFAULT 'technical'::text,
    content text NOT NULL,
    status text DEFAULT 'ok'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.monitoring_reports OWNER TO soundspa;

--
-- Name: monitoring_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: soundspa
--

CREATE SEQUENCE public.monitoring_reports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.monitoring_reports_id_seq OWNER TO soundspa;

--
-- Name: monitoring_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: soundspa
--

ALTER SEQUENCE public.monitoring_reports_id_seq OWNED BY public.monitoring_reports.id;


--
-- Name: payments; Type: TABLE; Schema: public; Owner: soundspa
--

CREATE TABLE public.payments (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    amount text,
    status text DEFAULT 'pending'::text,
    period_days integer DEFAULT 30,
    prodamus_id text,
    order_id text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.payments OWNER TO soundspa;

--
-- Name: payments_id_seq; Type: SEQUENCE; Schema: public; Owner: soundspa
--

CREATE SEQUENCE public.payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.payments_id_seq OWNER TO soundspa;

--
-- Name: payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: soundspa
--

ALTER SEQUENCE public.payments_id_seq OWNED BY public.payments.id;


--
-- Name: tenant_channels; Type: TABLE; Schema: public; Owner: soundspa
--

CREATE TABLE public.tenant_channels (
    tenant_id integer NOT NULL,
    channel_id integer NOT NULL,
    "order" integer DEFAULT 0 NOT NULL
);


ALTER TABLE public.tenant_channels OWNER TO soundspa;

--
-- Name: tenants; Type: TABLE; Schema: public; Owner: soundspa
--

CREATE TABLE public.tenants (
    id integer NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    brand_name text,
    trial_started_at timestamp with time zone,
    trial_ends_at timestamp with time zone,
    paid_till timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    users_count integer DEFAULT 0 NOT NULL
);


ALTER TABLE public.tenants OWNER TO soundspa;

--
-- Name: tenants_id_seq; Type: SEQUENCE; Schema: public; Owner: soundspa
--

CREATE SEQUENCE public.tenants_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.tenants_id_seq OWNER TO soundspa;

--
-- Name: tenants_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: soundspa
--

ALTER SEQUENCE public.tenants_id_seq OWNED BY public.tenants.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: soundspa
--

CREATE TABLE public.users (
    id integer NOT NULL,
    email text NOT NULL,
    password text NOT NULL,
    tenant_id integer NOT NULL,
    role text DEFAULT 'user'::text NOT NULL
);


ALTER TABLE public.users OWNER TO soundspa;

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: soundspa
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.users_id_seq OWNER TO soundspa;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: soundspa
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: agent_actions id; Type: DEFAULT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.agent_actions ALTER COLUMN id SET DEFAULT nextval('public.agent_actions_id_seq'::regclass);


--
-- Name: agents id; Type: DEFAULT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.agents ALTER COLUMN id SET DEFAULT nextval('public.agents_id_seq'::regclass);


--
-- Name: channels id; Type: DEFAULT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.channels ALTER COLUMN id SET DEFAULT nextval('public.channels_id_seq'::regclass);


--
-- Name: invites id; Type: DEFAULT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.invites ALTER COLUMN id SET DEFAULT nextval('public.invites_id_seq'::regclass);


--
-- Name: login_tokens id; Type: DEFAULT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.login_tokens ALTER COLUMN id SET DEFAULT nextval('public.login_tokens_id_seq'::regclass);


--
-- Name: monitoring_logs id; Type: DEFAULT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.monitoring_logs ALTER COLUMN id SET DEFAULT nextval('public.monitoring_logs_id_seq'::regclass);


--
-- Name: monitoring_reports id; Type: DEFAULT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.monitoring_reports ALTER COLUMN id SET DEFAULT nextval('public.monitoring_reports_id_seq'::regclass);


--
-- Name: payments id; Type: DEFAULT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.payments ALTER COLUMN id SET DEFAULT nextval('public.payments_id_seq'::regclass);


--
-- Name: tenants id; Type: DEFAULT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.tenants ALTER COLUMN id SET DEFAULT nextval('public.tenants_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Data for Name: __drizzle_migrations; Type: TABLE DATA; Schema: drizzle; Owner: soundspa
--

COPY drizzle.__drizzle_migrations (id, hash, created_at) FROM stdin;
0000_rapid_the_order	hash0	1776961082
0001_wakeful_gateway	hash1	1776961089
0002_monitoring_extensions	hash2	1776961095
\.


--
-- Data for Name: agent_actions; Type: TABLE DATA; Schema: public; Owner: soundspa
--

COPY public.agent_actions (id, tenant_id, agent_role, action, payload, status, external_id, error, created_at, updated_at, executed_at) FROM stdin;
\.


--
-- Data for Name: agents; Type: TABLE DATA; Schema: public; Owner: soundspa
--

COPY public.agents (id, tenant_id, name, model, temperature, system_prompt, is_active, kind) FROM stdin;
8	\N	uptime_guard	nvidia/nemotron-3-super-120b-a12b:free	0	Ты — агент технического мониторинга Sound Spa («uptime_guard»).\n\nТебе приходит JSON с тем же `MonitoringContext`, но интересует только:\n- disconnectionsCount по каждому салону;\n- totalDowntimeMinutes по каждому салону.\n\nТВОЯ ЗАДАЧА:\n1) Найти салоны, где:\n   - disconnectionsCount > 0, либо\n   - totalDowntimeMinutes > 0.\n2) Сформировать КОРОТКИЙ alert (1–3 абзаца максимум):\n   - перечислить проблемные салоны с цифрами разрывов и временем простоя;\n   - если всё стабильно — написать, что за период серьёзных проблем не было.\n3) Не расписывать каналы, сессии и т.д. — только стабильность соединения.\n\nСТИЛЬ:\n- Сухой технический отчёт, минимум эмоций.\n- Можно использовать ⚠️ / ✅ в начале строк.\n- Без длинных рекомендаций, максимум 1–2 предложения в конце.	f	monitoring
6	\N	watcher	nvidia/nemotron-3-super-120b-a12b:free	0	Роль: Ты — ИИ-аналитик «Watcher». Твоя цель: превратить сырую статистику MonitoringContext в сухую выжимку для бизнеса.\n\nСтиль: Юрий. Минимум слов, максимум фактов. Без вступлений типа «Согласно данным...». Только суть.\n\nАлгоритм анализа:\n\nПроверка на пустоту: Если во всех салонах playTimeMinutes == 0 и disconnectionsCount == 0 — верни ровно одно слово: SKIP.\n\nUptime vs Playtime: Если totalUptimeMinutes большой, а playTimeMinutes по каналам равен 0 — это аномалия (плеер включен, но звук не играет). Обязательно подсвети это.\n\nЛидеры: Укажи только ТОП-1 канал по времени проигрывания для каждого активного салона.\n\nСтабильность: Подсчитай общее кол-во разрывов. Если их > 3 на один салон — это «нестабильно».\n\nШаблон ответа (строго 5-10 строк):\n\nСалоны в работе: [ID салонов через запятую].\n\nТоп контент: [ID салона]: [ID канала] ([кол-во] мин).\n\nСвязь: [Кол-во] обрывов в [ID салонов]. Если всё чисто — "Стабильно".\n\nАномалии: (Только если есть простои при включенном uptime или частые рестарты).\n\nПравила SKIP:\n\nОтвечай SKIP, если данные идентичны предыдущему периоду или активность нулевая.\n\nОтвечай SKIP, если за последние 6 часов не было ни одного обрыва и музыка играла штатно.	t	monitoring
9	\N	support_bot	nvidia/nemotron-3-super-120b-a12b:free	0	Ты — аудитор каналов Sound Spa («channel_auditor»).\n\nТебе приходит `MonitoringContext` за период.\n\nТВОЯ ЗАДАЧА:\n1) По каждому салону выделить TOP‑3 каналов по `playTimeMinutes`.\n2) Отметить аномалии, например:\n   - один канал занимает > 80% времени (монотонность);\n   - слишком много переключений (`switchesCount`) при небольшом времени прослушивания;\n   - ни один канал не набрал заметного времени (почти не слушали).\n3) Сформировать выводы:\n   - какие каналы «якорные»;\n   - где стоит поэкспериментировать с плейлистами.\n\nСТИЛЬ:\n- Краткий консалтинг по каналам.\n- Не трогай соединение/разрывы — этим занимается другой агент.\n- Не пиши общие отчёты по салонам, фокус только на каналах.	f	monitoring
\.


--
-- Data for Name: channels; Type: TABLE DATA; Schema: public; Owner: soundspa
--

COPY public.channels (id, code, slug, display_name, mood, kind, stream_url, image, "order", is_new) FROM stdin;
1	deep_relax	deep-relax	Deep Relax	Relaxing · Live	music	https://radio.bodhemusic.com/listen/deep_relax/radio.mp3	/channel-1.jpg	1	f
2	spaquatoria_healing	spaquatoria-healing	Spaquatoria Healing	Deep · Live	music	https://radio.bodhemusic.com/listen/spaquatoria_healing/radio.mp3	/channel-2.jpg	2	f
3	dynamic_spa	dynamic-spa	Dynamic Spa 	Energizing · Live	music	https://radio.bodhemusic.com/listen/dynamic_spa/radio.mp3	/channel-3.jpg	3	f
4	divnitsa	divnitsa	Дивница	Signature · Live	music	https://radio.bodhemusic.com/listen/divnitsa/radio.mp3	/channel-divnitsa.jpg	4	f
10	432Hz	432Hz	432Hz	healing	music	https://radio.bodhemusic.com/listen/432hz/radio.mp3	/channel-432.jpg	5	f
6	forest_ambience	forest-ambience	Лес	Ambient · Forest	noise	https://radio.bodhemusic.com/listen/forest_2/radio.mp3	/noise-forest.jpg	6	f
8	night_ambience	night-ambience	Ночь	Ambient · Night	noise	https://radio.bodhemusic.com/listen/night_ambience/radio.mp3	/noise-night.jpg	7	f
9	rain_forest	rain_forest	Дождь	Ambient	noise	https://radio.bodhemusic.com/listen/rain_/radio.mp3	/noise-rain.jpg	8	f
7	sea_ambience	sea-ambience	Море	Ambient · Sea	noise	https://radio.bodhemusic.com/listen/sea_ambience/radio.mp3	/noise-sea.jpg	9	f
12	wind_chimes	wind_chimes	Японский сад	Ambient	noise	https://radio.bodhemusic.com/listen/wind_chimes/radio.mp3	/noise-windchimes.jpg	10	f
13	spiritual	spiritual	Spiritual	healing	noise	https://radio.bodhemusic.com/listen/spiritual/radio.mp3	/noise-spiritual.jpg	11	t
\.


--
-- Data for Name: invites; Type: TABLE DATA; Schema: public; Owner: soundspa
--

COPY public.invites (id, code, max_uses, used_count, expires_at, tenant_id, issued_to, created_by_user_id, used_by_tenant_id, used_by_user_id, base_label, rotation_interval_months, updated_at) FROM stdin;
1	SOUNDSPA-TEST	100	4	\N	\N	\N	\N	\N	\N	\N	\N	2026-04-23 16:20:12.946478+00
\.


--
-- Data for Name: login_tokens; Type: TABLE DATA; Schema: public; Owner: soundspa
--

COPY public.login_tokens (id, token, user_id, expires_at, used_at) FROM stdin;
34	5046eae112125c5568c66430eb2da365281655cbdfff7083a56dcbb682d059c4	5	2026-04-08 07:27:57.971+00	2026-04-08 06:58:19.6+00
16	88720966ba2d1affea0b9a786dcb8fc35e82b8a69dcfee60750383c2b71e7815	5	2026-04-08 13:20:38.847+00	2026-04-07 13:21:01.181+00
17	22ad2f3df85ffb3621fec7be3af7f04f02879f06e53bc470efc11bbcf231b4e5	5	2026-04-07 13:57:06.991+00	2026-04-07 13:27:27.137+00
18	5d9deb8e515b1c82f06023a87efa0b47b1ee5ec149292a17d4b543fb1f0373cb	5	2026-04-07 14:00:58.83+00	2026-04-07 13:31:17.709+00
30	883c47f21ac66a8d0f755d09221eda3a62ff3bc11a5625a2573641c141980525	5	2026-04-08 06:08:11.295+00	2026-04-08 05:38:31.821+00
31	d8a7cc9df5a474c401175c8e038f09dd9461679dbc97f3f5bf3d0d5eaa80a6f0	5	2026-04-08 07:22:10.16+00	2026-04-08 06:52:29.318+00
33	771f5d65cd485fd67d07b27936c4f8fc558e919a38fe9794865f3998e09a2a28	5	2026-04-08 07:26:59.571+00	2026-04-08 06:57:14.185+00
40	c6fd2726eb7d093eb26f8103f0ed113a1f60730cae7d63b489a864e23f8b52fa	5	2026-04-08 11:44:09.998+00	2026-04-08 11:14:23.452+00
42	f506df8285d2af6796cbfcb2eee7b19b60944431b50dd2d47585e8fd1eaa29a9	5	2026-04-21 09:21:37.422+00	\N
43	94f216be24453fca1a627456580e8c0644fb0deb044fe815e71c8dacb42988af	5	2026-04-21 09:22:19.49+00	\N
44	85f89d59e53e5bbfa49b1182353f776f98aa8c2ec29b62fcba8af0c58d4e0001	5	2026-04-21 10:26:15.262+00	2026-04-21 09:56:50.872+00
45	66b0abc003487d2ca67032aaa9a39554630dbae6ab90c9da571f8cd1917c2174	6	2026-04-22 14:52:37.029+00	2026-04-21 14:53:20.882+00
46	6d7e2396e2b2b294e52a89a43954509348d8bb543dbd8156147adaeaca10a088	1	2026-04-22 09:33:28.494+00	2026-04-22 09:03:43.464+00
47	c2cd60bd9acc168a8d515017eb64d89d1e5e15d368a7944c286c124dc15201cd	5	2026-04-22 09:34:09.368+00	\N
48	16167523ead055395835effaadd83540f833a7f527fa940636a7fe9f6a18c5ae	5	2026-04-22 09:38:37.316+00	2026-04-22 09:08:52.457+00
49	1644d531ee273497db9d536ce917ba08af2bf7fbb3c9dbe54fbb3391be064c84	1	2026-04-22 12:05:17.523+00	\N
50	10efb8095af0bba09ed1f24047b810c6e865618048ab2302b91d4a97722d65dd	1	2026-04-22 12:59:42.997+00	2026-04-22 12:30:01.529+00
51	96e935c331397e613ee613a112e84d883140219e5d5dbfde58712f0e0d3d7448	5	2026-04-22 13:04:39.016+00	2026-04-22 12:34:57.911+00
52	2ef4ed549d24b894745866fc31dcfc6c96ce963e11e249c31470db74b3b177b2	5	2026-04-22 13:25:45.771+00	2026-04-22 12:56:01.669+00
53	3327f7d2e94fe98abc81e621cc1d4655408af837ffcca2156d5c205dbbdfae7f	5	2026-04-22 13:42:39.444+00	2026-04-22 13:13:01.499+00
54	887522e68d59b0cb45ee84691b9bb263b2b1766883dbf9b8ed9cb5642c951a12	5	2026-04-22 18:50:25.875+00	\N
55	6e4c040d942bc7b8346ac10b6d36bb572423b9bf13f8fbcb944e2571f9e5fb32	5	2026-04-22 19:47:41.416+00	2026-04-22 19:17:59.716+00
56	d1dc84b32ac7a11a4f6e1a533c3fe31cbd84ae211a1a795c6c760907f60efb36	1	2026-04-23 07:02:52.405+00	2026-04-23 06:33:18.513+00
58	bcf067aad9cafb57de0b3810569f57c6834797b36dad4974267aa5d8a1e2fad9	1	2026-04-25 15:19:31.261+00	2026-04-25 14:49:47.28+00
59	caaa82ec70ab38d36590bd490a39bb3e5e04150b012a4bf4885648e9ba2059cc	1	2026-04-25 16:51:52.355+00	2026-04-25 16:22:16.971+00
60	f8060b62de56817ddf6fc5230235259e7c410852e17a2d51e946cc041734fac1	5	2026-04-25 17:36:49.642+00	2026-04-25 17:07:12.369+00
61	bb7cfc9c091bcc3bbf9c04f875a0679055136e3084ac5e4da94e11434dc4231f	6	2026-04-25 17:43:09.745+00	2026-04-25 17:13:38.288+00
62	574ce134fa2a548e416e5a2f41bde5d18495ff0d3195fb6cfa5049619784748e	1	2026-04-27 03:52:21.667+00	2026-04-27 03:22:38.269+00
63	dac5e993dd84ee85a2bb610843194a6b605756270a57eaa6a70163afa1526485	5	2026-04-28 04:14:50.705+00	2026-04-28 03:45:21.548+00
64	373d5161da56b424d3fff4a8b0c0a4dc363211abb8bdf5efdd294c50324aff73	1	2026-04-28 19:05:08.893+00	\N
65	b7f7298981dbd22be5a75efe51a333b8a7ad4d6f33715943a238c8826e10bb68	5	2026-04-29 02:48:10.209+00	2026-04-29 02:18:41.413+00
66	2f0065686a74c234fb98eda59d51f3c552acacfdb501d27393b85fbcac0c9a8c	5	2026-04-29 02:49:39.245+00	\N
67	2679417775b4b5d1f0fcf6d6a14c01ed97ae20baf1f8120acaf900b8f5d7dca7	5	2026-04-29 03:43:31.945+00	2026-04-29 03:13:54.872+00
68	3f6f88b4a8a80aca601e6f8af74bf89f902bf0432d366b0a90e596dd5fa45032	5	2026-04-29 07:20:38.652+00	\N
69	a7f4963c0329a24bc01d019dca5a7fca61548ead75fc7062562c93430487cf39	1	2026-04-29 15:52:11.571+00	2026-04-29 15:22:35.559+00
70	a563418c66e51412b597b47c04169eedb7d8ccf20f91c3dfde40823c02bf11d5	1	2026-04-29 16:29:45.989+00	2026-04-29 16:00:18.897+00
71	4f0e22aac230f70d0c926d7689f68c0927d11f977fd07159e456717b3caeb1fb	1	2026-04-29 16:30:51.701+00	2026-04-29 16:01:09.471+00
72	iamadmin	1	2026-04-29 17:10:58.489127+00	2026-04-29 16:11:20.012+00
74	e5d1c38f353929b2aeef824cbefad569e81727ed6b04f4b9ee94e3242a050de3	1	2026-04-29 17:14:42.158+00	\N
\.


--
-- Data for Name: monitoring_current; Type: TABLE DATA; Schema: public; Owner: soundspa
--

COPY public.monitoring_current (tenant_id, status, last_ping, metadata) FROM stdin;
3	offline	2026-04-29 13:38:22.169+00	{"status": "online", "version": "1.2.0", "eventType": "player_heartbeat", "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36", "clientType": "desktop"}
4	offline	2026-04-25 18:45:52.13+00	{"device": "Desktop-Player", "noiseId": "8", "channelId": "1", "eventType": "player_heartbeat", "sessionId": "sess_1p9bttj_1777140877136"}
1	paused	2026-04-30 05:49:00.427+00	{"status": "paused", "version": "1.2.0", "eventType": "player_heartbeat", "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36", "clientType": "desktop", "isBuffering": false}
\.


--
-- Data for Name: monitoring_logs; Type: TABLE DATA; Schema: public; Owner: soundspa
--

COPY public.monitoring_logs (id, tenant_id, event, level, details, created_at, event_type, session_id, channel_id, user_agent, client_type, is_buffering, noise_id) FROM stdin;
1317	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 10:50:33.38133+00	player_heartbeat	\N	\N	\N	\N	f	\N
1318	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 10:51:33.381993+00	player_heartbeat	\N	\N	\N	\N	f	\N
1353	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:15:41.548243+00	player_heartbeat	\N	\N	\N	\N	f	\N
1354	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:15:54.098094+00	player_heartbeat	\N	\N	\N	\N	f	\N
1401	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:39:53.561461+00	player_heartbeat	\N	\N	\N	\N	f	\N
1402	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:39:54.183127+00	player_heartbeat	\N	\N	\N	\N	f	\N
1449	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:03:54.580599+00	player_heartbeat	\N	\N	\N	\N	f	\N
1450	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:04:03.557045+00	player_heartbeat	\N	\N	\N	\N	f	\N
1496	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:28:22.157421+00	player_heartbeat	\N	\N	\N	\N	f	\N
1497	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:28:29.936393+00	player_heartbeat	\N	\N	\N	\N	f	\N
1544	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:52:22.169689+00	player_heartbeat	\N	\N	\N	\N	f	\N
1545	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:52:30.032126+00	player_heartbeat	\N	\N	\N	\N	f	\N
1319	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 10:52:33.382642+00	player_heartbeat	\N	\N	\N	\N	f	\N
1355	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:16:42.555401+00	player_heartbeat	\N	\N	\N	\N	f	\N
1356	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:16:54.095057+00	player_heartbeat	\N	\N	\N	\N	f	\N
1403	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:40:54.191002+00	player_heartbeat	\N	\N	\N	\N	f	\N
1404	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:40:54.547771+00	player_heartbeat	\N	\N	\N	\N	f	\N
1451	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:04:54.583752+00	player_heartbeat	\N	\N	\N	\N	f	\N
1452	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:05:04.556085+00	player_heartbeat	\N	\N	\N	\N	f	\N
1498	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:29:22.160133+00	player_heartbeat	\N	\N	\N	\N	f	\N
1499	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:29:32.033832+00	player_heartbeat	\N	\N	\N	\N	f	\N
1546	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:53:22.167544+00	player_heartbeat	\N	\N	\N	\N	f	\N
1547	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:53:30.166907+00	player_heartbeat	\N	\N	\N	\N	f	\N
1320	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 10:53:33.396266+00	player_heartbeat	\N	\N	\N	\N	f	\N
1357	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:17:43.561594+00	player_heartbeat	\N	\N	\N	\N	f	\N
1358	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:17:54.096563+00	player_heartbeat	\N	\N	\N	\N	f	\N
1405	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:41:54.204342+00	player_heartbeat	\N	\N	\N	\N	f	\N
1406	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:41:55.555452+00	player_heartbeat	\N	\N	\N	\N	f	\N
1453	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:05:54.604261+00	player_heartbeat	\N	\N	\N	\N	f	\N
1454	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:06:04.558576+00	player_heartbeat	\N	\N	\N	\N	f	\N
1500	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:30:22.157659+00	player_heartbeat	\N	\N	\N	\N	f	\N
1501	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:30:29.995211+00	player_heartbeat	\N	\N	\N	\N	f	\N
1548	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:54:22.17022+00	player_heartbeat	\N	\N	\N	\N	f	\N
1549	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:54:30.03531+00	player_heartbeat	\N	\N	\N	\N	f	\N
1321	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 10:54:33.382964+00	player_heartbeat	\N	\N	\N	\N	f	\N
1359	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:18:43.56504+00	player_heartbeat	\N	\N	\N	\N	f	\N
1360	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:18:54.110183+00	player_heartbeat	\N	\N	\N	\N	f	\N
1407	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:42:54.197965+00	player_heartbeat	\N	\N	\N	\N	f	\N
1408	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:42:55.553956+00	player_heartbeat	\N	\N	\N	\N	f	\N
1455	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:06:54.603265+00	player_heartbeat	\N	\N	\N	\N	f	\N
1456	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:07:05.562979+00	player_heartbeat	\N	\N	\N	\N	f	\N
1502	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:31:22.15867+00	player_heartbeat	\N	\N	\N	\N	f	\N
1503	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:31:29.948365+00	player_heartbeat	\N	\N	\N	\N	f	\N
1550	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:55:22.180874+00	player_heartbeat	\N	\N	\N	\N	f	\N
1551	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:55:30.072382+00	player_heartbeat	\N	\N	\N	\N	f	\N
1322	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 10:55:33.54655+00	player_heartbeat	\N	\N	\N	\N	f	\N
1361	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:19:44.552113+00	player_heartbeat	\N	\N	\N	\N	f	\N
1362	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:19:54.106503+00	player_heartbeat	\N	\N	\N	\N	f	\N
1409	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:43:54.209259+00	player_heartbeat	\N	\N	\N	\N	f	\N
1410	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:43:55.54946+00	player_heartbeat	\N	\N	\N	\N	f	\N
1457	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:07:54.376572+00	player_heartbeat	\N	\N	\N	\N	f	\N
1458	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:08:06.555337+00	player_heartbeat	\N	\N	\N	\N	f	\N
1504	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:32:22.535302+00	player_heartbeat	\N	\N	\N	\N	f	\N
1505	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:32:29.95836+00	player_heartbeat	\N	\N	\N	\N	f	\N
1552	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:56:22.245444+00	player_heartbeat	\N	\N	\N	\N	f	\N
1553	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:56:30.065048+00	player_heartbeat	\N	\N	\N	\N	f	\N
1323	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 10:56:33.382561+00	player_heartbeat	\N	\N	\N	\N	f	\N
1363	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:20:45.550441+00	player_heartbeat	\N	\N	\N	\N	f	\N
1364	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:20:54.114947+00	player_heartbeat	\N	\N	\N	\N	f	\N
1411	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:44:54.211518+00	player_heartbeat	\N	\N	\N	\N	f	\N
1412	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:44:55.549296+00	player_heartbeat	\N	\N	\N	\N	f	\N
1459	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:08:54.725538+00	player_heartbeat	\N	\N	\N	\N	f	\N
1460	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:09:06.554959+00	player_heartbeat	\N	\N	\N	\N	f	\N
1506	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:33:22.166689+00	player_heartbeat	\N	\N	\N	\N	f	\N
1507	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:33:29.956627+00	player_heartbeat	\N	\N	\N	\N	f	\N
1554	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:57:22.175944+00	player_heartbeat	\N	\N	\N	\N	f	\N
1555	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:57:30.097911+00	player_heartbeat	\N	\N	\N	\N	f	\N
1324	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 10:57:33.383074+00	player_heartbeat	\N	\N	\N	\N	f	\N
1365	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:21:45.555782+00	player_heartbeat	\N	\N	\N	\N	f	\N
1366	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:21:54.10472+00	player_heartbeat	\N	\N	\N	\N	f	\N
1413	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:45:54.232147+00	player_heartbeat	\N	\N	\N	\N	f	\N
1414	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:45:55.551509+00	player_heartbeat	\N	\N	\N	\N	f	\N
1461	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:09:54.310251+00	player_heartbeat	\N	\N	\N	\N	f	\N
1462	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:10:06.56047+00	player_heartbeat	\N	\N	\N	\N	f	\N
1463	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:10:33.403762+00	player_heartbeat	\N	\N	\N	\N	f	\N
1464	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:10:56.563596+00	player_heartbeat	\N	\N	\N	\N	f	\N
1508	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:34:22.161676+00	player_heartbeat	\N	\N	\N	\N	f	\N
1509	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:34:29.964933+00	player_heartbeat	\N	\N	\N	\N	f	\N
1556	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:58:22.176046+00	player_heartbeat	\N	\N	\N	\N	f	\N
1557	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:58:30.054843+00	player_heartbeat	\N	\N	\N	\N	f	\N
1325	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 10:58:33.385169+00	player_heartbeat	\N	\N	\N	\N	f	\N
1367	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:22:45.564355+00	player_heartbeat	\N	\N	\N	\N	f	\N
1368	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:22:54.121418+00	player_heartbeat	\N	\N	\N	\N	f	\N
1415	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:46:54.349677+00	player_heartbeat	\N	\N	\N	\N	f	\N
1416	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:46:55.552366+00	player_heartbeat	\N	\N	\N	\N	f	\N
1465	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:11:33.568372+00	player_heartbeat	\N	\N	\N	\N	f	\N
1466	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:11:54.423363+00	player_heartbeat	\N	\N	\N	\N	f	\N
1510	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:35:22.161866+00	player_heartbeat	\N	\N	\N	\N	f	\N
1511	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:35:30.011064+00	player_heartbeat	\N	\N	\N	\N	f	\N
1558	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:59:22.172579+00	player_heartbeat	\N	\N	\N	\N	f	\N
1559	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:59:30.081617+00	player_heartbeat	\N	\N	\N	\N	f	\N
1326	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 10:59:33.395576+00	player_heartbeat	\N	\N	\N	\N	f	\N
1369	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:23:45.55462+00	player_heartbeat	\N	\N	\N	\N	f	\N
1370	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:23:54.132428+00	player_heartbeat	\N	\N	\N	\N	f	\N
1417	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:47:54.23446+00	player_heartbeat	\N	\N	\N	\N	f	\N
1418	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:47:56.55166+00	player_heartbeat	\N	\N	\N	\N	f	\N
1467	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:12:34.567418+00	player_heartbeat	\N	\N	\N	\N	f	\N
1512	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:36:22.163514+00	player_heartbeat	\N	\N	\N	\N	f	\N
1513	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:36:29.969621+00	player_heartbeat	\N	\N	\N	\N	f	\N
1560	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:00:22.171578+00	player_heartbeat	\N	\N	\N	\N	f	\N
1561	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:00:30.071103+00	player_heartbeat	\N	\N	\N	\N	f	\N
1327	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:00:34.512404+00	player_heartbeat	\N	\N	\N	\N	f	\N
1371	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:24:46.553026+00	player_heartbeat	\N	\N	\N	\N	f	\N
1372	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:24:54.125653+00	player_heartbeat	\N	\N	\N	\N	f	\N
1419	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:48:54.221051+00	player_heartbeat	\N	\N	\N	\N	f	\N
1420	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:48:56.552094+00	player_heartbeat	\N	\N	\N	\N	f	\N
1468	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:13:35.202875+00	player_heartbeat	\N	\N	\N	\N	f	\N
1469	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:13:35.562527+00	player_heartbeat	\N	\N	\N	\N	f	\N
1470	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:13:53.942265+00	player_heartbeat	\N	\N	\N	\N	f	\N
1514	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:37:22.161702+00	player_heartbeat	\N	\N	\N	\N	f	\N
1515	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:37:29.987958+00	player_heartbeat	\N	\N	\N	\N	f	\N
1562	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:01:22.172761+00	player_heartbeat	\N	\N	\N	\N	f	\N
1563	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:01:30.080112+00	player_heartbeat	\N	\N	\N	\N	f	\N
1328	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:01:33.544755+00	player_heartbeat	\N	\N	\N	\N	f	\N
1373	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:25:47.550859+00	player_heartbeat	\N	\N	\N	\N	f	\N
1374	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:25:54.125738+00	player_heartbeat	\N	\N	\N	\N	f	\N
1421	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:49:54.285073+00	player_heartbeat	\N	\N	\N	\N	f	\N
1422	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:49:56.550309+00	player_heartbeat	\N	\N	\N	\N	f	\N
1471	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:14:36.579324+00	player_heartbeat	\N	\N	\N	\N	f	\N
1516	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:38:22.162307+00	player_heartbeat	\N	\N	\N	\N	f	\N
1517	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:38:29.979806+00	player_heartbeat	\N	\N	\N	\N	f	\N
1564	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:02:22.533456+00	player_heartbeat	\N	\N	\N	\N	f	\N
1565	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:02:30.12803+00	player_heartbeat	\N	\N	\N	\N	f	\N
1329	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:02:34.214286+00	player_heartbeat	\N	\N	\N	\N	f	\N
1375	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:26:47.555486+00	player_heartbeat	\N	\N	\N	\N	f	\N
1376	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:26:54.13635+00	player_heartbeat	\N	\N	\N	\N	f	\N
1423	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:50:54.284421+00	player_heartbeat	\N	\N	\N	\N	f	\N
1424	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:50:56.552789+00	player_heartbeat	\N	\N	\N	\N	f	\N
1472	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:15:36.569269+00	player_heartbeat	\N	\N	\N	\N	f	\N
1518	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:39:22.162707+00	player_heartbeat	\N	\N	\N	\N	f	\N
1519	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:39:29.988578+00	player_heartbeat	\N	\N	\N	\N	f	\N
1566	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:03:22.171767+00	player_heartbeat	\N	\N	\N	\N	f	\N
1567	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:03:30.133223+00	player_heartbeat	\N	\N	\N	\N	f	\N
1330	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:03:31.233268+00	player_heartbeat	\N	\N	\N	\N	f	\N
1331	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:03:33.539089+00	player_heartbeat	\N	\N	\N	\N	f	\N
1377	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:27:47.553246+00	player_heartbeat	\N	\N	\N	\N	f	\N
1378	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:27:54.128426+00	player_heartbeat	\N	\N	\N	\N	f	\N
1425	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:51:54.898102+00	player_heartbeat	\N	\N	\N	\N	f	\N
1426	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:51:57.55196+00	player_heartbeat	\N	\N	\N	\N	f	\N
1473	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:16:29.960774+00	player_heartbeat	\N	\N	\N	\N	f	\N
1474	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:16:37.557985+00	player_heartbeat	\N	\N	\N	\N	f	\N
1520	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:40:22.167292+00	player_heartbeat	\N	\N	\N	\N	f	\N
1521	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:40:29.982543+00	player_heartbeat	\N	\N	\N	\N	f	\N
1568	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:04:22.16745+00	player_heartbeat	\N	\N	\N	\N	f	\N
1569	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:04:30.074397+00	player_heartbeat	\N	\N	\N	\N	f	\N
1332	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:04:31.117089+00	player_heartbeat	\N	\N	\N	\N	f	\N
1333	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:04:34.534704+00	player_heartbeat	\N	\N	\N	\N	f	\N
1379	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:28:47.561292+00	player_heartbeat	\N	\N	\N	\N	f	\N
1380	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:28:54.157031+00	player_heartbeat	\N	\N	\N	\N	f	\N
1427	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:52:54.290082+00	player_heartbeat	\N	\N	\N	\N	f	\N
1428	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:52:58.556533+00	player_heartbeat	\N	\N	\N	\N	f	\N
1475	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:17:29.975327+00	player_heartbeat	\N	\N	\N	\N	f	\N
1476	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:17:38.558677+00	player_heartbeat	\N	\N	\N	\N	f	\N
1522	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:41:22.165446+00	player_heartbeat	\N	\N	\N	\N	f	\N
1523	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:41:29.992805+00	player_heartbeat	\N	\N	\N	\N	f	\N
1570	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:05:22.17256+00	player_heartbeat	\N	\N	\N	\N	f	\N
1571	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:05:30.077742+00	player_heartbeat	\N	\N	\N	\N	f	\N
1334	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:05:31.120114+00	player_heartbeat	\N	\N	\N	\N	f	\N
1335	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:05:34.538812+00	player_heartbeat	\N	\N	\N	\N	f	\N
1381	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:29:48.559957+00	player_heartbeat	\N	\N	\N	\N	f	\N
1382	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:29:54.144005+00	player_heartbeat	\N	\N	\N	\N	f	\N
1429	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:53:54.303619+00	player_heartbeat	\N	\N	\N	\N	f	\N
1430	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:53:58.557872+00	player_heartbeat	\N	\N	\N	\N	f	\N
1477	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:18:29.918844+00	player_heartbeat	\N	\N	\N	\N	f	\N
1478	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:18:39.559557+00	player_heartbeat	\N	\N	\N	\N	f	\N
1524	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:42:22.174615+00	player_heartbeat	\N	\N	\N	\N	f	\N
1525	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:42:29.988972+00	player_heartbeat	\N	\N	\N	\N	f	\N
1572	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:06:22.179904+00	player_heartbeat	\N	\N	\N	\N	f	\N
1573	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:06:30.080977+00	player_heartbeat	\N	\N	\N	\N	f	\N
1336	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:06:31.125366+00	player_heartbeat	\N	\N	\N	\N	f	\N
1337	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:06:35.534974+00	player_heartbeat	\N	\N	\N	\N	f	\N
1383	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:30:49.555865+00	player_heartbeat	\N	\N	\N	\N	f	\N
1384	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:30:54.197278+00	player_heartbeat	\N	\N	\N	\N	f	\N
1431	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:54:54.484665+00	player_heartbeat	\N	\N	\N	\N	f	\N
1432	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:54:59.554611+00	player_heartbeat	\N	\N	\N	\N	f	\N
1479	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:19:29.92501+00	player_heartbeat	\N	\N	\N	\N	f	\N
1480	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:19:40.557912+00	player_heartbeat	\N	\N	\N	\N	f	\N
1526	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:43:22.168342+00	player_heartbeat	\N	\N	\N	\N	f	\N
1527	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:43:30.088142+00	player_heartbeat	\N	\N	\N	\N	f	\N
1574	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:07:22.171421+00	player_heartbeat	\N	\N	\N	\N	f	\N
1575	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:07:30.090391+00	player_heartbeat	\N	\N	\N	\N	f	\N
1338	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:07:31.1237+00	player_heartbeat	\N	\N	\N	\N	f	\N
1339	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:07:35.540716+00	player_heartbeat	\N	\N	\N	\N	f	\N
1385	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:31:50.558569+00	player_heartbeat	\N	\N	\N	\N	f	\N
1386	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:31:54.149121+00	player_heartbeat	\N	\N	\N	\N	f	\N
1433	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:55:54.266784+00	player_heartbeat	\N	\N	\N	\N	f	\N
1434	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:55:59.557369+00	player_heartbeat	\N	\N	\N	\N	f	\N
1481	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:20:29.930341+00	player_heartbeat	\N	\N	\N	\N	f	\N
1482	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:20:41.558853+00	player_heartbeat	\N	\N	\N	\N	f	\N
1528	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:44:22.170459+00	player_heartbeat	\N	\N	\N	\N	f	\N
1529	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:44:30.015874+00	player_heartbeat	\N	\N	\N	\N	f	\N
1576	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:08:22.170823+00	player_heartbeat	\N	\N	\N	\N	f	\N
1577	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:08:30.101327+00	player_heartbeat	\N	\N	\N	\N	f	\N
1340	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:08:31.120982+00	player_heartbeat	\N	\N	\N	\N	f	\N
1341	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:08:35.536777+00	player_heartbeat	\N	\N	\N	\N	f	\N
1387	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:32:52.10961+00	player_heartbeat	\N	\N	\N	\N	f	\N
1388	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:32:54.236866+00	player_heartbeat	\N	\N	\N	\N	f	\N
1435	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:56:55.856993+00	player_heartbeat	\N	\N	\N	\N	f	\N
1436	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:56:59.552712+00	player_heartbeat	\N	\N	\N	\N	f	\N
1483	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:21:29.927252+00	player_heartbeat	\N	\N	\N	\N	f	\N
1484	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:21:41.561153+00	player_heartbeat	\N	\N	\N	\N	f	\N
1530	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:45:22.166536+00	player_heartbeat	\N	\N	\N	\N	f	\N
1531	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:45:30.099568+00	player_heartbeat	\N	\N	\N	\N	f	\N
1578	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:09:22.168727+00	player_heartbeat	\N	\N	\N	\N	f	\N
1579	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:09:30.09851+00	player_heartbeat	\N	\N	\N	\N	f	\N
1342	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:09:31.187889+00	player_heartbeat	\N	\N	\N	\N	f	\N
1343	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:09:36.536809+00	player_heartbeat	\N	\N	\N	\N	f	\N
1389	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:33:50.555105+00	player_heartbeat	\N	\N	\N	\N	f	\N
1390	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:33:54.173035+00	player_heartbeat	\N	\N	\N	\N	f	\N
1437	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:57:54.409013+00	player_heartbeat	\N	\N	\N	\N	f	\N
1438	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:58:00.554128+00	player_heartbeat	\N	\N	\N	\N	f	\N
1485	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:22:29.990816+00	player_heartbeat	\N	\N	\N	\N	f	\N
1486	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:22:41.566382+00	player_heartbeat	\N	\N	\N	\N	f	\N
1532	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:46:22.166304+00	player_heartbeat	\N	\N	\N	\N	f	\N
1533	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:46:30.110459+00	player_heartbeat	\N	\N	\N	\N	f	\N
1580	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:10:22.168963+00	player_heartbeat	\N	\N	\N	\N	f	\N
1581	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:10:30.296636+00	player_heartbeat	\N	\N	\N	\N	f	\N
1344	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:10:31.134358+00	player_heartbeat	\N	\N	\N	\N	f	\N
1345	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:10:37.548032+00	player_heartbeat	\N	\N	\N	\N	f	\N
1391	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:34:50.572983+00	player_heartbeat	\N	\N	\N	\N	f	\N
1392	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:34:54.159451+00	player_heartbeat	\N	\N	\N	\N	f	\N
1439	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:58:54.332485+00	player_heartbeat	\N	\N	\N	\N	f	\N
1440	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:59:01.553137+00	player_heartbeat	\N	\N	\N	\N	f	\N
1487	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:23:30.056682+00	player_heartbeat	\N	\N	\N	\N	f	\N
1534	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:47:22.1652+00	player_heartbeat	\N	\N	\N	\N	f	\N
1535	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:47:30.019434+00	player_heartbeat	\N	\N	\N	\N	f	\N
1346	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:11:38.550959+00	player_heartbeat	\N	\N	\N	\N	f	\N
1393	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:35:51.55683+00	player_heartbeat	\N	\N	\N	\N	f	\N
1394	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:35:54.189328+00	player_heartbeat	\N	\N	\N	\N	f	\N
1441	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:59:54.550402+00	player_heartbeat	\N	\N	\N	\N	f	\N
1442	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:00:01.557763+00	player_heartbeat	\N	\N	\N	\N	f	\N
1488	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:24:22.159377+00	player_heartbeat	\N	\N	\N	\N	f	\N
1489	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:24:29.932353+00	player_heartbeat	\N	\N	\N	\N	f	\N
1536	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:48:22.164724+00	player_heartbeat	\N	\N	\N	\N	f	\N
1537	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:48:30.012604+00	player_heartbeat	\N	\N	\N	\N	f	\N
1347	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:12:39.55872+00	player_heartbeat	\N	\N	\N	\N	f	\N
1348	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:12:54.107535+00	player_heartbeat	\N	\N	\N	\N	f	\N
1395	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:36:51.555366+00	player_heartbeat	\N	\N	\N	\N	f	\N
1396	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:36:54.257508+00	player_heartbeat	\N	\N	\N	\N	f	\N
1443	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:00:54.288233+00	player_heartbeat	\N	\N	\N	\N	f	\N
1444	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:01:01.557298+00	player_heartbeat	\N	\N	\N	\N	f	\N
1490	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:25:22.158664+00	player_heartbeat	\N	\N	\N	\N	f	\N
1491	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:25:30.054552+00	player_heartbeat	\N	\N	\N	\N	f	\N
1538	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:49:22.167757+00	player_heartbeat	\N	\N	\N	\N	f	\N
1539	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:49:30.028062+00	player_heartbeat	\N	\N	\N	\N	f	\N
1349	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:13:39.54749+00	player_heartbeat	\N	\N	\N	\N	f	\N
1350	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:13:54.110703+00	player_heartbeat	\N	\N	\N	\N	f	\N
1397	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:37:52.559826+00	player_heartbeat	\N	\N	\N	\N	f	\N
1398	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:37:54.168116+00	player_heartbeat	\N	\N	\N	\N	f	\N
1445	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:01:54.45925+00	player_heartbeat	\N	\N	\N	\N	f	\N
1446	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:02:02.554569+00	player_heartbeat	\N	\N	\N	\N	f	\N
1492	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:26:22.160187+00	player_heartbeat	\N	\N	\N	\N	f	\N
1493	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:26:29.935074+00	player_heartbeat	\N	\N	\N	\N	f	\N
1540	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:50:22.169135+00	player_heartbeat	\N	\N	\N	\N	f	\N
1541	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:50:30.024539+00	player_heartbeat	\N	\N	\N	\N	f	\N
1246	1	ping	info	{"eventType":"player_heartbeat","sessionId":"sess_d80cni4_1777284331045","channelId":"10","noiseId":"13","device":"Desktop-Player"}	2026-04-27 10:08:31.67052+00	player_heartbeat	sess_d80cni4_1777284331045	10	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15	\N	f	\N
1247	1	ping	info	{"eventType":"player_heartbeat","sessionId":"sess_d80cni4_1777284331045","channelId":"10","noiseId":"13","device":"Desktop-Player"}	2026-04-27 10:09:31.617769+00	player_heartbeat	sess_d80cni4_1777284331045	10	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15	\N	f	\N
1306	1	ping	info	No extra data	2026-04-27 18:06:52.841241+00	\N	\N	\N	\N	\N	f	\N
1351	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:14:40.549688+00	player_heartbeat	\N	\N	\N	\N	f	\N
1308	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 10:41:33.397867+00	player_heartbeat	\N	\N	\N	\N	f	\N
1309	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 10:42:33.381446+00	player_heartbeat	\N	\N	\N	\N	f	\N
1310	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 10:43:33.385612+00	player_heartbeat	\N	\N	\N	\N	f	\N
1311	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 10:44:33.381652+00	player_heartbeat	\N	\N	\N	\N	f	\N
1312	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 10:45:33.397279+00	player_heartbeat	\N	\N	\N	\N	f	\N
1313	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 10:46:33.378979+00	player_heartbeat	\N	\N	\N	\N	f	\N
1314	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 10:47:33.391148+00	player_heartbeat	\N	\N	\N	\N	f	\N
1315	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 10:48:33.386822+00	player_heartbeat	\N	\N	\N	\N	f	\N
1316	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 10:49:33.384771+00	player_heartbeat	\N	\N	\N	\N	f	\N
1352	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:14:54.142594+00	player_heartbeat	\N	\N	\N	\N	f	\N
1399	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:38:52.557869+00	player_heartbeat	\N	\N	\N	\N	f	\N
1400	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 11:38:54.2263+00	player_heartbeat	\N	\N	\N	\N	f	\N
1447	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:02:54.565316+00	player_heartbeat	\N	\N	\N	\N	f	\N
1448	3	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:03:03.92035+00	player_heartbeat	\N	\N	\N	\N	f	\N
1494	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:27:22.162245+00	player_heartbeat	\N	\N	\N	\N	f	\N
1495	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:27:29.938808+00	player_heartbeat	\N	\N	\N	\N	f	\N
1542	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 12:51:22.168538+00	player_heartbeat	\N	\N	\N	\N	f	\N
1543	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 12:51:30.144605+00	player_heartbeat	\N	\N	\N	\N	f	\N
1582	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:11:22.170332+00	player_heartbeat	\N	\N	\N	\N	f	\N
1583	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:11:30.104697+00	player_heartbeat	\N	\N	\N	\N	f	\N
1584	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:12:22.171003+00	player_heartbeat	\N	\N	\N	\N	f	\N
1585	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:12:30.102174+00	player_heartbeat	\N	\N	\N	\N	f	\N
1586	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:13:22.177871+00	player_heartbeat	\N	\N	\N	\N	f	\N
1587	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:13:30.163195+00	player_heartbeat	\N	\N	\N	\N	f	\N
1588	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:14:22.179014+00	player_heartbeat	\N	\N	\N	\N	f	\N
1589	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:14:30.201814+00	player_heartbeat	\N	1	\N	\N	f	\N
1590	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:15:22.184184+00	player_heartbeat	\N	1	\N	\N	f	6
1591	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:15:30.535004+00	player_heartbeat	\N	1	\N	\N	f	\N
1592	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:16:22.174603+00	player_heartbeat	\N	1	\N	\N	f	6
1593	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:16:30.128039+00	player_heartbeat	\N	1	\N	\N	f	\N
1594	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:17:22.175006+00	player_heartbeat	\N	10	\N	\N	f	13
1595	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:17:30.12151+00	player_heartbeat	\N	1	\N	\N	f	\N
1596	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:18:22.176623+00	player_heartbeat	\N	10	\N	\N	f	13
1597	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:18:30.13607+00	player_heartbeat	\N	1	\N	\N	f	\N
1598	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:19:22.17743+00	player_heartbeat	\N	10	\N	\N	f	13
1599	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:19:30.130742+00	player_heartbeat	\N	1	\N	\N	f	\N
1600	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:20:22.176257+00	player_heartbeat	\N	10	\N	\N	f	13
1601	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:20:32.101893+00	player_heartbeat	\N	1	\N	\N	f	\N
1602	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:21:22.175655+00	player_heartbeat	\N	10	\N	\N	f	13
1603	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:21:30.374455+00	player_heartbeat	\N	1	\N	\N	f	\N
1604	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:22:22.174609+00	player_heartbeat	\N	10	\N	\N	f	13
1605	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:22:30.174791+00	player_heartbeat	\N	1	\N	\N	f	\N
1606	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:23:22.17971+00	player_heartbeat	\N	10	\N	\N	f	13
1607	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:23:30.282659+00	player_heartbeat	\N	1	\N	\N	f	\N
1608	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:24:22.176268+00	player_heartbeat	\N	10	\N	\N	f	13
1609	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:24:30.18979+00	player_heartbeat	\N	1	\N	\N	f	\N
1610	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:25:22.18704+00	player_heartbeat	\N	10	\N	\N	f	13
1611	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:25:32.019472+00	player_heartbeat	\N	1	\N	\N	f	\N
1612	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:26:22.177622+00	player_heartbeat	\N	10	\N	\N	f	13
1613	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:26:30.202522+00	player_heartbeat	\N	1	\N	\N	f	\N
1614	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:27:22.176956+00	player_heartbeat	\N	10	\N	\N	f	13
1615	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:27:30.211334+00	player_heartbeat	\N	1	\N	\N	f	\N
1616	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:28:22.179556+00	player_heartbeat	\N	10	\N	\N	f	13
1617	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:28:30.216745+00	player_heartbeat	\N	1	\N	\N	f	\N
1618	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:29:22.174389+00	player_heartbeat	\N	10	\N	\N	f	13
1619	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:29:31.454983+00	player_heartbeat	\N	1	\N	\N	f	\N
1620	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:30:22.257206+00	player_heartbeat	\N	10	\N	\N	f	13
1621	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:30:30.237369+00	player_heartbeat	\N	1	\N	\N	f	\N
1622	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:31:22.190634+00	player_heartbeat	\N	10	\N	\N	f	13
1623	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:31:30.249361+00	player_heartbeat	\N	1	\N	\N	f	\N
1624	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:32:22.544941+00	player_heartbeat	\N	10	\N	\N	f	13
1625	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:32:30.251383+00	player_heartbeat	\N	1	\N	\N	f	\N
1626	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:33:22.196424+00	player_heartbeat	\N	10	\N	\N	f	13
1627	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:33:30.357751+00	player_heartbeat	\N	1	\N	\N	f	\N
1628	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:34:22.183086+00	player_heartbeat	\N	10	\N	\N	f	13
1629	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:34:30.205862+00	player_heartbeat	\N	1	\N	\N	f	\N
1630	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:35:22.271532+00	player_heartbeat	\N	10	\N	\N	f	13
1631	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:35:30.273353+00	player_heartbeat	\N	1	\N	\N	f	\N
1632	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:36:22.194425+00	player_heartbeat	\N	10	\N	\N	f	13
1633	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:36:30.280027+00	player_heartbeat	\N	1	\N	\N	f	\N
1634	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:37:22.181437+00	player_heartbeat	\N	10	\N	\N	f	13
1635	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:37:30.286019+00	player_heartbeat	\N	1	\N	\N	f	\N
1636	3	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"}	2026-04-29 13:38:22.183968+00	player_heartbeat	\N	10	\N	\N	f	13
1637	1	ping	info	{"version":"1.2.0","eventType":"player_heartbeat"}	2026-04-29 13:38:30.391746+00	player_heartbeat	\N	1	\N	\N	f	\N
1638	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:23:36.388281+00	player_heartbeat	\N	1	\N	\N	f	6
1639	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:24:36.390836+00	player_heartbeat	\N	1	\N	\N	f	6
1640	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:25:36.381535+00	player_heartbeat	\N	1	\N	\N	f	6
1641	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:26:36.383358+00	player_heartbeat	\N	1	\N	\N	f	6
1642	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:27:36.390125+00	player_heartbeat	\N	1	\N	\N	f	6
1643	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:28:36.384443+00	player_heartbeat	\N	1	\N	\N	f	6
1644	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:29:36.382566+00	player_heartbeat	\N	1	\N	\N	f	6
1645	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:30:36.753198+00	player_heartbeat	\N	1	\N	\N	f	6
1646	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:31:36.389371+00	player_heartbeat	\N	1	\N	\N	f	6
1647	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:32:36.396764+00	player_heartbeat	\N	1	\N	\N	f	6
1648	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:33:36.386471+00	player_heartbeat	\N	1	\N	\N	f	6
1649	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:34:36.386242+00	player_heartbeat	\N	1	\N	\N	f	6
1650	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:35:36.384667+00	player_heartbeat	\N	1	\N	\N	f	6
1651	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:36:36.390399+00	player_heartbeat	\N	1	\N	\N	f	6
1652	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:37:36.385423+00	player_heartbeat	\N	1	\N	\N	f	6
1653	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:38:36.387957+00	player_heartbeat	\N	1	\N	\N	f	6
1654	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:39:36.396594+00	player_heartbeat	\N	1	\N	\N	f	6
1655	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:40:36.388735+00	player_heartbeat	\N	1	\N	\N	f	6
1656	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:41:36.386817+00	player_heartbeat	\N	1	\N	\N	f	6
1657	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:42:36.393095+00	player_heartbeat	\N	1	\N	\N	f	6
1658	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:43:36.389804+00	player_heartbeat	\N	1	\N	\N	f	6
1659	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:44:36.388803+00	player_heartbeat	\N	1	\N	\N	f	6
1660	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:45:36.388153+00	player_heartbeat	\N	1	\N	\N	f	6
1661	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:46:36.39069+00	player_heartbeat	\N	1	\N	\N	f	6
1662	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:47:36.392632+00	player_heartbeat	\N	1	\N	\N	f	6
1663	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:48:36.388575+00	player_heartbeat	\N	1	\N	\N	f	6
1664	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:49:36.389322+00	player_heartbeat	\N	1	\N	\N	f	6
1665	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:50:36.389584+00	player_heartbeat	\N	1	\N	\N	f	6
1666	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:51:36.39014+00	player_heartbeat	\N	1	\N	\N	f	6
1667	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:52:36.395804+00	player_heartbeat	\N	1	\N	\N	f	6
1668	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:53:36.395541+00	player_heartbeat	\N	1	\N	\N	f	6
1669	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:54:36.394824+00	player_heartbeat	\N	1	\N	\N	f	6
1670	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:55:36.390447+00	player_heartbeat	\N	1	\N	\N	f	6
1671	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:56:36.392644+00	player_heartbeat	\N	1	\N	\N	f	6
1672	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:57:36.396944+00	player_heartbeat	\N	1	\N	\N	f	6
1673	1	ping	info	{"eventType":"player_heartbeat","status":"online","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-29 15:58:36.393079+00	player_heartbeat	\N	1	\N	\N	f	6
1674	1	ping	info	{"eventType":"player_heartbeat","status":"paused","version":"1.2.0","clientType":"desktop","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36","isBuffering":false}	2026-04-30 05:49:00.443416+00	player_heartbeat	\N	\N	\N	\N	f	\N
\.


--
-- Data for Name: monitoring_reports; Type: TABLE DATA; Schema: public; Owner: soundspa
--

COPY public.monitoring_reports (id, tenant_id, agent_name, type, content, status, created_at) FROM stdin;
9	1	watcher	tenant_signal	Салоны в работе: 1.  \nТоп контент: 1: канал неизвестен (0 мин).  \nСвязь: Стабильно.  \nАномалии: uptime ~145 мин, playtime=0 — плеер включён без звука.  \nБез обрывов.	ok	2026-04-29 13:31:08.404226+00
10	1	watcher	tenant_signal	Салоны в работе: 1.  \nТоп контент: 1: нет данных (0 мин).  \nСвязь: Стабильно.  \nАномалии: плеер включен, но звук не играет (uptime >0, playtime=0).  \nUptime: ~237 мин.	ok	2026-04-29 16:31:00.546654+00
11	1	watcher	tenant_signal	Салоны в работе: 1.  \nТоп контент: 1: нет данных (0 мин).  \nСвязь: 0 обрывов в 1. Стабильно.  \nАномалии: uptime ~360 мин, playTime = 0 — проигрывание отсутствует при включенном плеере.  \nСредний интервал пинга: 60 сек.	ok	2026-04-29 17:00:45.292205+00
\.


--
-- Data for Name: payments; Type: TABLE DATA; Schema: public; Owner: soundspa
--

COPY public.payments (id, tenant_id, amount, status, period_days, prodamus_id, order_id, created_at) FROM stdin;
\.


--
-- Data for Name: tenant_channels; Type: TABLE DATA; Schema: public; Owner: soundspa
--

COPY public.tenant_channels (tenant_id, channel_id, "order") FROM stdin;
1	1	1
1	2	2
1	3	3
1	4	4
3	1	1
3	2	2
3	3	3
1	6	5
1	7	6
1	8	7
1	9	8
3	4	4
3	10	5
3	6	6
3	8	7
3	9	8
3	7	9
3	12	10
4	1	1
4	2	2
4	3	3
4	4	4
4	10	5
4	6	6
4	8	7
4	9	8
4	7	9
4	12	10
4	13	11
3	13	11
1	10	9
1	13	10
1	12	11
\.


--
-- Data for Name: tenants; Type: TABLE DATA; Schema: public; Owner: soundspa
--

COPY public.tenants (id, name, slug, brand_name, trial_started_at, trial_ends_at, paid_till, created_at, users_count) FROM stdin;
4	Angels Spa	angels-spa	Angels Spa	2026-04-21 14:52:37.029+00	2026-05-21 14:52:37.029+00	\N	2026-04-21 14:52:37.03443+00	1
1	Soundspa Main	soundspa-main	Soundspa Main	2026-04-07 08:47:16.752+00	2026-04-17 08:47:16.752+00	2027-01-12 00:00:00+00	2026-04-20 04:52:52.376723+00	1
3	Soundspa	soundspa	Soundspa	2026-04-07 13:20:38.847+00	2026-04-17 13:20:38.847+00	2026-05-12 00:00:00+00	2026-04-20 04:52:52.376723+00	1
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: soundspa
--

COPY public.users (id, email, password, tenant_id, role) FROM stdin;
5	yurybodhe@gmail.com	magic-link-only	3	user
1	108aura@gmail.com	1080	1	user
6	theloftangel@gmail.com	magic-link-only	4	user
\.


--
-- Name: agent_actions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: soundspa
--

SELECT pg_catalog.setval('public.agent_actions_id_seq', 1, false);


--
-- Name: agents_id_seq; Type: SEQUENCE SET; Schema: public; Owner: soundspa
--

SELECT pg_catalog.setval('public.agents_id_seq', 9, true);


--
-- Name: channels_id_seq; Type: SEQUENCE SET; Schema: public; Owner: soundspa
--

SELECT pg_catalog.setval('public.channels_id_seq', 13, true);


--
-- Name: invites_id_seq; Type: SEQUENCE SET; Schema: public; Owner: soundspa
--

SELECT pg_catalog.setval('public.invites_id_seq', 1, true);


--
-- Name: login_tokens_id_seq; Type: SEQUENCE SET; Schema: public; Owner: soundspa
--

SELECT pg_catalog.setval('public.login_tokens_id_seq', 74, true);


--
-- Name: monitoring_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: soundspa
--

SELECT pg_catalog.setval('public.monitoring_logs_id_seq', 1674, true);


--
-- Name: monitoring_reports_id_seq; Type: SEQUENCE SET; Schema: public; Owner: soundspa
--

SELECT pg_catalog.setval('public.monitoring_reports_id_seq', 11, true);


--
-- Name: payments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: soundspa
--

SELECT pg_catalog.setval('public.payments_id_seq', 1, false);


--
-- Name: tenants_id_seq; Type: SEQUENCE SET; Schema: public; Owner: soundspa
--

SELECT pg_catalog.setval('public.tenants_id_seq', 4, true);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: soundspa
--

SELECT pg_catalog.setval('public.users_id_seq', 6, true);


--
-- Name: __drizzle_migrations __drizzle_migrations_pkey; Type: CONSTRAINT; Schema: drizzle; Owner: soundspa
--

ALTER TABLE ONLY drizzle.__drizzle_migrations
    ADD CONSTRAINT __drizzle_migrations_pkey PRIMARY KEY (id);


--
-- Name: agent_actions agent_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.agent_actions
    ADD CONSTRAINT agent_actions_pkey PRIMARY KEY (id);


--
-- Name: agents agents_pkey; Type: CONSTRAINT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_pkey PRIMARY KEY (id);


--
-- Name: channels channels_code_unique; Type: CONSTRAINT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.channels
    ADD CONSTRAINT channels_code_unique UNIQUE (code);


--
-- Name: channels channels_pkey; Type: CONSTRAINT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.channels
    ADD CONSTRAINT channels_pkey PRIMARY KEY (id);


--
-- Name: channels channels_slug_unique; Type: CONSTRAINT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.channels
    ADD CONSTRAINT channels_slug_unique UNIQUE (slug);


--
-- Name: invites invites_code_unique; Type: CONSTRAINT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.invites
    ADD CONSTRAINT invites_code_unique UNIQUE (code);


--
-- Name: invites invites_pkey; Type: CONSTRAINT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.invites
    ADD CONSTRAINT invites_pkey PRIMARY KEY (id);


--
-- Name: login_tokens login_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.login_tokens
    ADD CONSTRAINT login_tokens_pkey PRIMARY KEY (id);


--
-- Name: login_tokens login_tokens_token_unique; Type: CONSTRAINT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.login_tokens
    ADD CONSTRAINT login_tokens_token_unique UNIQUE (token);


--
-- Name: monitoring_current monitoring_current_pkey; Type: CONSTRAINT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.monitoring_current
    ADD CONSTRAINT monitoring_current_pkey PRIMARY KEY (tenant_id);


--
-- Name: monitoring_logs monitoring_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.monitoring_logs
    ADD CONSTRAINT monitoring_logs_pkey PRIMARY KEY (id);


--
-- Name: monitoring_reports monitoring_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.monitoring_reports
    ADD CONSTRAINT monitoring_reports_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_slug_unique; Type: CONSTRAINT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_slug_unique UNIQUE (slug);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: agent_actions_status_idx; Type: INDEX; Schema: public; Owner: soundspa
--

CREATE INDEX agent_actions_status_idx ON public.agent_actions USING btree (status);


--
-- Name: agent_actions_tenant_idx; Type: INDEX; Schema: public; Owner: soundspa
--

CREATE INDEX agent_actions_tenant_idx ON public.agent_actions USING btree (tenant_id);


--
-- Name: monitoring_logs_tenant_idx; Type: INDEX; Schema: public; Owner: soundspa
--

CREATE INDEX monitoring_logs_tenant_idx ON public.monitoring_logs USING btree (tenant_id);


--
-- Name: tenant_channels_pk; Type: INDEX; Schema: public; Owner: soundspa
--

CREATE UNIQUE INDEX tenant_channels_pk ON public.tenant_channels USING btree (tenant_id, channel_id);


--
-- Name: unique_email_tenant; Type: INDEX; Schema: public; Owner: soundspa
--

CREATE UNIQUE INDEX unique_email_tenant ON public.users USING btree (email, tenant_id);


--
-- Name: agent_actions agent_actions_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.agent_actions
    ADD CONSTRAINT agent_actions_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: agents agents_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: invites invites_created_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.invites
    ADD CONSTRAINT invites_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: invites invites_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.invites
    ADD CONSTRAINT invites_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;


--
-- Name: invites invites_used_by_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.invites
    ADD CONSTRAINT invites_used_by_tenant_id_tenants_id_fk FOREIGN KEY (used_by_tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;


--
-- Name: invites invites_used_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.invites
    ADD CONSTRAINT invites_used_by_user_id_users_id_fk FOREIGN KEY (used_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: login_tokens login_tokens_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.login_tokens
    ADD CONSTRAINT login_tokens_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: monitoring_current monitoring_current_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.monitoring_current
    ADD CONSTRAINT monitoring_current_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: monitoring_logs monitoring_logs_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.monitoring_logs
    ADD CONSTRAINT monitoring_logs_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: monitoring_reports monitoring_reports_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.monitoring_reports
    ADD CONSTRAINT monitoring_reports_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: payments payments_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_channels tenant_channels_channel_id_channels_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.tenant_channels
    ADD CONSTRAINT tenant_channels_channel_id_channels_id_fk FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE;


--
-- Name: tenant_channels tenant_channels_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.tenant_channels
    ADD CONSTRAINT tenant_channels_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: users users_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: soundspa
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict dFbl6bgBcj2LcLIX4EbafCzAfZkf7hB3mJbJcseI8WDycBWEqqGihFJI6QoUyGW

