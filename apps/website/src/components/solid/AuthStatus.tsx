import { Show, createSignal } from "solid-js";
import { Button } from "@f0rbit/ui";

type User = {
	id: string;
	name: string | null;
	email: string | null;
};

interface Props {
	initialUser?: User | null;
	initialAuthenticated?: boolean;
}

export default function AuthStatus(props: Props) {
	const [user] = createSignal<User | null>(props.initialUser ?? null);
	// Use the authenticated flag from SSR, not just user presence
	const isAuthenticated = () => props.initialAuthenticated ?? !!user();

	const handleLogin = () => {
		window.location.href = "/media/api/auth/login";
	};

	const handleLogout = () => {
		window.location.href = "/media/api/auth/logout";
	};

	return (
		<div class="user-info">
			<Show when={isAuthenticated()} fallback={<Button onClick={handleLogin}>Login</Button>}>
				<Show when={user()}>{u => <span class="user-name">{u().name || u().email || "User"}</span>}</Show>
				<Button variant="secondary" onClick={handleLogout}>
					Logout
				</Button>
			</Show>
		</div>
	);
}
