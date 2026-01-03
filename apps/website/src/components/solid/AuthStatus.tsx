import { Show, createSignal } from "solid-js";

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

	const handleLogin = () => {
		window.location.href = "/media/api/auth/login";
	};

	const handleLogout = () => {
		window.location.href = "/media/api/auth/logout";
	};

	return (
		<div class="user-info">
			<Show
				when={user()}
				fallback={
					<button onClick={handleLogin} class="auth-btn login-btn">
						Login
					</button>
				}
			>
				{u => (
					<>
						<span class="user-name">{u().name || u().email || "User"}</span>
						<button onClick={handleLogout} class="auth-btn logout-btn">
							Logout
						</button>
					</>
				)}
			</Show>
		</div>
	);
}
