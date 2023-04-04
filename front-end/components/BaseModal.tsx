import { Cross, X } from "lucide-react";
import React from "react";
import { Transition } from "react-transition-group";

const duration = 300;

const modalDefaultStyle = {
	transition: `opacity ${duration}ms ease-in-out, transform ${duration}ms ease-in-out`,
	opacity: 0,
	transform: "scale(0.9)",
};

const modalTransitionStyles: any = {
	entering: { opacity: 1, transform: "scale(1)" },
	entered: { opacity: 1, transform: "scale(1)" },
	exiting: { opacity: 0, transform: "scale(0.9)" },
	exited: { opacity: 0, transform: "scale(0.9)" },
};

const backgroundDefaultStyle = {
	transition: `opacity ${duration}ms ease-in-out`,
	opacity: 0,
};

const backgroundTransitionStyles: any = {
	entering: { opacity: 0.5 },
	entered: { opacity: 0.5 },
	exiting: { opacity: 0 },
	exited: { opacity: 0 },
};

function Modal({ isOpen, onClose, children }: { isOpen: boolean; onClose: () => void; children: React.ReactNode }) {
	return (
		<>
			<Transition in={isOpen} timeout={duration} unmountOnExit>
				{(state) => (
					<div
						style={{
							...backgroundDefaultStyle,
							...backgroundTransitionStyles[state],
						}}
						className="fixed inset-0 z-50 overflow-auto bg-black"
						// onClick={() => onClose()}
					></div>
				)}
			</Transition>
			<Transition in={isOpen} timeout={duration} unmountOnExit>
				{(state) => (
					<div
						style={{
							...modalDefaultStyle,
							...modalTransitionStyles[state],
						}}
						className="fixed inset-0 z-50 flex items-center justify-center"
					>
						{children}
					</div>
				)}
			</Transition>
		</>
	);
}

export default Modal;

export function ModalLayout({ children, onClose, className }: { children: React.ReactNode; onClose: () => void; className?: string }) {
	return (
		<div className={"relative bg-base-primary border border-base-secondary shadow-sm py-4 px-6 rounded mx-auto max-w-[90vw] " + className}>
			<button className="absolute top-0 right-0 cursor-pointer flex flex-col items-center mt-4 mr-4 text-white text-sm z-50 hover:text-gray-200" onClick={onClose}>
				<X />
			</button>
			{children}
		</div>
	);
}
