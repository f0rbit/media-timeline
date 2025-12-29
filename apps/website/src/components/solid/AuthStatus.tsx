import { Show, createResource } from "solid-js";

type User = {
	id: string;
	name: string | null;
	email: string | null;
};

const checkAuth = async (): Promise<User | null> => {
	try {
		const res = await fetch("/api/v1/me", { credentials: "include" });
		if (!res.ok) return null;
		return (await res.json()) as User;
	} catch {
		return null;
	}
};

export default function AuthStatus() {
	const [user] = createResource(checkAuth);

	const handleLogin = () => {
		const returnUrl = encodeURIComponent(window.location.href);
		window.location.href = `https://devpad.tools/login?redirect=${returnUrl}`;
	};

	const handleLogout = async () => {
		await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
		window.location.href = "/";
	};

	return (
		<Show when={!user.loading}>
			<Show
				when={user()}
				fallback={
					<button onClick={handleLogin} class="auth-btn login-btn">
						Login
					</button>
				}
			>
				<div class="user-info">
					<span class="user-name">{user()?.name || user()?.email || "User"}</span>
					<button onClick={handleLogout} class="auth-btn logout-btn">
						Logout
					</button>
				</div>
			</Show>
		</Show>
	);
}
