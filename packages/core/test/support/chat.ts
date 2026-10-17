import type {
	ChatClient,
	ChatClientFactory,
	ChatClientOptions,
	ChatRequest,
} from "../../src/net/chat.ts";

export type FakeChat = ChatClient & {
	requests: ChatRequest[];
	/** Pass as `createChat`; records each client's options and returns this fake. */
	factory: ChatClientFactory;
	created: ChatClientOptions[];
};

/** A chat service that answers each request with `respond`, which may throw to fail it. */
export function fakeChat(respond: (request: ChatRequest) => unknown): FakeChat {
	const requests: ChatRequest[] = [];
	const created: ChatClientOptions[] = [];
	const chat: FakeChat = {
		requests,
		created,
		factory: (options) => {
			created.push(options);
			return chat;
		},
		requestJson: async (request) => {
			requests.push(request);
			return await respond(request);
		},
	};
	return chat;
}
